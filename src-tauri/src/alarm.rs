//! The focus timer's alarm: one background thread that sleeps until the open
//! session's deadline, closes it, emits `focus-ended` with the closed
//! `FocusSession` as payload, and shows an OS notification.
//!
//! Rust owns this rather than a webview `setTimeout` because the window spends
//! most of a pomodoro hidden or minimised, which is exactly when a webview's
//! timers get throttled.
//!
//! The thread only ever *tries* `focus::expire`, which closes nothing that has
//! not actually run out. So a stale deadline is harmless, and the commands
//! need only report each new one through `follow`: start and resume arm it,
//! pause and finish disarm it.

use crate::db::Db;
use crate::model::{FocusKind, FocusSession};
use crate::{focus, tasks};
use chrono::{DateTime, Utc};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// The event the frontend listens for. Fired only when the alarm itself closed
/// the session — a command that closes one returns it instead.
pub const FOCUS_ENDED: &str = "focus-ended";

/// Longest single sleep. The channel timeout runs on the monotonic clock, which
/// on Linux stops during suspend, so a laptop that sleeps through a deadline
/// would otherwise ring late by the length of the nap. Waking this often to
/// re-read the wall clock bounds that to `RECHECK` after resume.
const RECHECK: Duration = Duration::from_secs(30);

/// Managed state: the sending half of the alarm thread's channel.
pub struct Alarm(mpsc::Sender<Option<DateTime<Utc>>>);

impl Alarm {
    /// Re-arm for `session`'s deadline, or disarm when it has none (paused,
    /// ended, or no session). Never blocks.
    pub fn follow(&self, session: Option<&FocusSession>) {
        // Only fails if the thread is gone, and then there is nobody to tell.
        let _ = self.0.send(session.and_then(FocusSession::deadline));
    }
}

pub fn spawn(app: AppHandle) -> std::io::Result<Alarm> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("focus-alarm".into())
        .spawn(move || run(app, rx))?;
    Ok(Alarm(tx))
}

fn run(app: AppHandle, rx: mpsc::Receiver<Option<DateTime<Utc>>>) {
    let mut deadline: Option<DateTime<Utc>> = None;
    loop {
        let received = match deadline {
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(at) => {
                let wait = (at - Utc::now()).to_std().unwrap_or(Duration::ZERO);
                rx.recv_timeout(wait.min(RECHECK))
            }
        };
        match received {
            Ok(next) => deadline = next,
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {
                if deadline.is_some_and(|at| Utc::now() >= at) {
                    deadline = None;
                    ring(&app);
                }
            }
        }
    }
}

fn ring(app: &AppHandle) {
    let (session, title) = {
        let db = app.state::<Db>();
        let Ok(conn) = db.0.lock() else {
            return;
        };
        match focus::expire(&conn, Utc::now()) {
            Ok(Some(session)) => {
                let title = session
                    .task_id
                    .as_deref()
                    .and_then(|id| tasks::title_of(&conn, id).ok().flatten());
                (session, title)
            }
            // Paused, finished or resumed since the deadline was armed.
            Ok(None) => return,
            Err(e) => {
                eprintln!("focus alarm: {e}");
                return;
            }
        }
    };

    if let Err(e) = app.emit(FOCUS_ENDED, &session) {
        eprintln!("focus alarm: emit failed: {e}");
    }

    let (heading, body) = match session.kind {
        FocusKind::Work => (
            "Pomodoro done",
            match title {
                Some(title) => format!("{title} — time for a break."),
                None => "Time for a break.".to_string(),
            },
        ),
        FocusKind::ShortBreak | FocusKind::LongBreak => {
            ("Break over", "Ready for the next session?".to_string())
        }
    };
    if let Err(e) = app
        .notification()
        .builder()
        .title(heading)
        .body(body)
        .show()
    {
        eprintln!("focus alarm: notification failed: {e}");
    }
}
