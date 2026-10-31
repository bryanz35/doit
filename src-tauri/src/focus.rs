//! Pomodoro sessions over a plain `rusqlite::Connection`, like `tasks`.
//!
//! A session row holds instants — started, paused, ended — and never a
//! countdown. Remaining time is derived on every read (`derive`), so the timer
//! survives page switches, restarts and suspend without anything ticking.
//!
//! Every function takes `now` instead of reading the clock, so the tests can
//! drive time; the commands pass `Utc::now()`. `now` is truncated to whole
//! seconds on the way in, since that is all an instant column can hold.
//!
//! Every function also calls `expire` first. A session whose timer ran out is
//! closed lazily, by whichever read or write touches it next — the alarm
//! thread in `alarm.rs` is just the reader that shows up on time.

use crate::error::{AppError, Result};
use crate::model::{FocusDay, FocusInterruption, FocusKind, FocusOutcome, FocusSession};
use crate::tasks::{check_instant, format_instant};
use chrono::{DateTime, Duration, SubsecRound, Utc};
use rusqlite::{params, Connection, OptionalExtension, Params, Row};

/// Every column `row_to_session` reads, same contract as `tasks::TASK_COLUMNS`.
const SESSION_COLUMNS: &str = "id, task_id, block_id, kind, started_at, planned_seconds, \
     paused_at, paused_seconds, ended_at, outcome";

/// Bounds on a session's planned length. Below a minute is a misclick; above
/// four hours is not a pomodoro, and a typo there would hold the alarm for days.
pub const MIN_PLANNED_SECONDS: i64 = 60;
pub const MAX_PLANNED_SECONDS: i64 = 4 * 60 * 60;

fn tick(now: DateTime<Utc>) -> DateTime<Utc> {
    now.trunc_subsecs(0)
}

fn row_to_session(row: &Row) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        block_id: row.get("block_id")?,
        kind: row.get("kind")?,
        started_at: row.get("started_at")?,
        planned_seconds: row.get("planned_seconds")?,
        paused_at: row.get("paused_at")?,
        paused_seconds: row.get("paused_seconds")?,
        ended_at: row.get("ended_at")?,
        outcome: row.get("outcome")?,
        ends_at: None,
        remaining_seconds: 0,
        elapsed_seconds: 0,
        interruptions: Vec::new(),
    })
}

fn row_to_interruption(row: &Row) -> rusqlite::Result<FocusInterruption> {
    Ok(FocusInterruption {
        id: row.get("id")?,
        session_id: row.get("session_id")?,
        at: row.get("at")?,
        note: row.get("note")?,
    })
}

/// Fill in the fields that depend on `now`. The clock stops at `ended_at` if
/// the session is over, at `paused_at` if it is paused, and runs to `now`
/// otherwise; pauses already folded into `paused_seconds` never count.
fn derive(s: &mut FocusSession, now: DateTime<Utc>) -> Result<()> {
    let started = check_instant(&s.started_at)?;
    let stop = match (&s.ended_at, &s.paused_at) {
        (Some(ended), _) => check_instant(ended)?,
        (None, Some(paused)) => check_instant(paused)?,
        (None, None) => now,
    };
    let elapsed = ((stop - started).num_seconds() - s.paused_seconds).clamp(0, s.planned_seconds);
    s.elapsed_seconds = elapsed;
    s.remaining_seconds = if s.ended_at.is_some() {
        0
    } else {
        s.planned_seconds - elapsed
    };
    s.ends_at = (s.ended_at.is_none() && s.paused_at.is_none())
        .then(|| format_instant(started + Duration::seconds(s.paused_seconds + s.planned_seconds)));
    Ok(())
}

impl FocusSession {
    /// When the timer runs out, if it is running. What the alarm sleeps until.
    pub fn deadline(&self) -> Option<DateTime<Utc>> {
        self.ends_at.as_deref().and_then(|t| check_instant(t).ok())
    }
}

/// Sessions matching `filter`, ordered by start, derived and with their
/// interruptions attached.
fn select<P: Params>(
    conn: &Connection,
    filter: &str,
    params: P,
    now: DateTime<Utc>,
) -> Result<Vec<FocusSession>> {
    let sql = format!(
        "SELECT {SESSION_COLUMNS} FROM focus_sessions WHERE {filter} ORDER BY started_at, id"
    );
    let mut tmp = conn.prepare(&sql)?;
    let mut sessions = tmp
        .query_map(params, row_to_session)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut notes = conn.prepare_cached(
        "SELECT id, session_id, at, note FROM focus_interruptions
         WHERE session_id = ?1 ORDER BY at, id",
    )?;
    for s in &mut sessions {
        derive(s, now)?;
        s.interruptions = notes
            .query_map(params![s.id], row_to_interruption)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }
    Ok(sessions)
}

fn get(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<FocusSession> {
    select(conn, "id = ?1", params![id], now)?
        .pop()
        .ok_or_else(|| AppError::Invalid(format!("no focus session with id {id}")))
}

/// The open session, if any. The unique index guarantees at most one.
fn open(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    Ok(select(conn, "ended_at IS NULL", [], now)?.pop())
}

fn require_open(conn: &Connection, now: DateTime<Utc>) -> Result<FocusSession> {
    open(conn, now)?.ok_or(AppError::NoFocusSession)
}

/// Seconds a paused session has been paused for, 0 if it is running. Clamped
/// so a clock that jumped backwards cannot subtract time.
fn pause_gap(s: &FocusSession, now: DateTime<Utc>) -> Result<i64> {
    match s.paused_at.as_deref() {
        Some(paused) => Ok((now - check_instant(paused)?).num_seconds().max(0)),
        None => Ok(0),
    }
}

/// Close the open session if its timer has run out, and return it; `None` if
/// nothing needed closing. A paused session never expires.
///
/// It ends *at its deadline*, not at `now`: a pomodoro left running while the
/// app was closed over lunch records 25 minutes, not two hours, and always as
/// `Completed` — the time was served, whatever the user does next.
pub fn expire(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    let now = tick(now);
    let Some(s) = open(conn, now)? else {
        return Ok(None);
    };
    let Some(deadline) = s.deadline() else {
        return Ok(None);
    };
    if deadline > now {
        return Ok(None);
    }
    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?2, outcome = ?3 WHERE id = ?1",
        params![s.id, format_instant(deadline), FocusOutcome::Completed],
    )?;
    get(conn, &s.id, now).map(Some)
}

/// The open session, after closing it if it has run out. What the frontend
/// asks for on launch and whenever the window comes back into view.
pub fn current(conn: &Connection, now: DateTime<Utc>) -> Result<Option<FocusSession>> {
    let now = tick(now);
    expire(conn, now)?;
    open(conn, now)
}

/// Start a session now. Refused while another is open — the caller finishes
/// that one first, so an outcome is never recorded without being chosen.
///
/// When the task has a calendar block covering this moment, the session is
/// logged against it.
pub fn start(
    conn: &Connection,
    task_id: Option<&str>,
    kind: FocusKind,
    planned_seconds: i64,
    now: DateTime<Utc>,
) -> Result<FocusSession> {
    let now = tick(now);
    if !(MIN_PLANNED_SECONDS..=MAX_PLANNED_SECONDS).contains(&planned_seconds) {
        return Err(AppError::Invalid(format!(
            "a session must last {MIN_PLANNED_SECONDS}-{MAX_PLANNED_SECONDS} seconds, \
             received {planned_seconds}"
        )));
    }
    expire(conn, now)?;
    if open(conn, now)?.is_some() {
        return Err(AppError::Invalid(
            "a focus session is already running; finish it first".into(),
        ));
    }

    let started_at = format_instant(now);
    let block_id: Option<String> = match task_id {
        Some(task_id) => {
            conn.query_row(
                "SELECT 1 FROM tasks WHERE id = ?1",
                params![task_id],
                |_| Ok(()),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(task_id.to_string()))?;
            conn.query_row(
                "SELECT id FROM task_blocks
                 WHERE task_id = ?1 AND start_at <= ?2 AND end_at > ?2
                 ORDER BY start_at, id LIMIT 1",
                params![task_id, started_at],
                |r| r.get(0),
            )
            .optional()?
        }
        None => None,
    };

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO focus_sessions (id, task_id, block_id, kind, started_at, planned_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, task_id, block_id, kind, started_at, planned_seconds],
    )?;
    get(conn, &id, now)
}

/// Freeze the open session. Pausing a paused session is a no-op, so a double
/// press cannot move the pause point.
pub fn pause(conn: &Connection, now: DateTime<Utc>) -> Result<FocusSession> {
    let now = tick(now);
    expire(conn, now)?;
    let s = require_open(conn, now)?;
    if s.paused_at.is_some() {
        return Ok(s);
    }
    conn.execute(
        "UPDATE focus_sessions SET paused_at = ?2 WHERE id = ?1",
        params![s.id, format_instant(now)],
    )?;
    get(conn, &s.id, now)
}

/// Unfreeze the open session: the pause is folded into `paused_seconds`, which
/// pushes the deadline back by exactly its length. A no-op if it is running.
pub fn resume(conn: &Connection, now: DateTime<Utc>) -> Result<FocusSession> {
    let now = tick(now);
    expire(conn, now)?;
    let s = require_open(conn, now)?;
    if s.paused_at.is_none() {
        return Ok(s);
    }
    conn.execute(
        "UPDATE focus_sessions
         SET paused_at = NULL, paused_seconds = paused_seconds + ?2
         WHERE id = ?1",
        params![s.id, pause_gap(&s, now)?],
    )?;
    get(conn, &s.id, now)
}

/// End the open session with `outcome` and return it. Idempotent: with no
/// session open it returns `None` rather than failing, because the alarm and
/// the frontend can both try to close the same session.
///
/// If the timer has already run out, the session closes as `Completed` at its
/// deadline whatever `outcome` says — skipping a break that is already over
/// does not un-take it. A paused session's pause is folded in first.
pub fn finish(
    conn: &Connection,
    outcome: FocusOutcome,
    now: DateTime<Utc>,
) -> Result<Option<FocusSession>> {
    let now = tick(now);
    if let Some(expired) = expire(conn, now)? {
        return Ok(Some(expired));
    }
    let Some(s) = open(conn, now)? else {
        return Ok(None);
    };
    // The schema insists ended_at >= started_at; a clock set backwards since
    // the start would otherwise turn a finish into a constraint error.
    let ended = now.max(check_instant(&s.started_at)?);
    conn.execute(
        "UPDATE focus_sessions
         SET ended_at = ?2, outcome = ?3, paused_at = NULL, paused_seconds = paused_seconds + ?4
         WHERE id = ?1",
        params![s.id, format_instant(ended), outcome, pause_gap(&s, now)?],
    )?;
    get(conn, &s.id, now).map(Some)
}

/// Note a distraction against the open session and return the session.
pub fn log_interruption(conn: &Connection, note: &str, now: DateTime<Utc>) -> Result<FocusSession> {
    let now = tick(now);
    let note = note.trim();
    if note.is_empty() {
        return Err(AppError::Invalid(
            "Interruption note must not be empty".into(),
        ));
    }
    expire(conn, now)?;
    let s = require_open(conn, now)?;
    conn.execute(
        "INSERT INTO focus_interruptions (id, session_id, at, note) VALUES (?1, ?2, ?3, ?4)",
        params![
            uuid::Uuid::new_v4().to_string(),
            s.id,
            format_instant(now),
            note
        ],
    )?;
    get(conn, &s.id, now)
}

/// The sessions started in `[from, to)` and their totals. The range is the
/// caller's local day as UTC instants — only the frontend knows where its
/// midnight falls. Half-open, so a session starting at exactly midnight
/// belongs to the day it starts.
pub fn day(conn: &Connection, from: &str, to: &str, now: DateTime<Utc>) -> Result<FocusDay> {
    let now = tick(now);
    if check_instant(to)? <= check_instant(from)? {
        return Err(AppError::Invalid(format!(
            "range must end after it starts, received {from} -> {to}"
        )));
    }
    expire(conn, now)?;
    let sessions = select(
        conn,
        "started_at >= ?1 AND started_at < ?2",
        params![from, to],
        now,
    )?;
    let work = || sessions.iter().filter(|s| s.kind == FocusKind::Work);
    Ok(FocusDay {
        from: from.to_string(),
        to: to.to_string(),
        pomodoros: work()
            .filter(|s| s.outcome == Some(FocusOutcome::Completed))
            .count() as i64,
        focused_seconds: work().map(|s| s.elapsed_seconds).sum(),
        sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::tasks;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    /// 2026-09-14 09:00:00 UTC plus `minutes`.
    fn at(minutes: i64) -> DateTime<Utc> {
        check_instant("2026-09-14T09:00:00Z").unwrap() + Duration::minutes(minutes)
    }

    fn task(conn: &mut Connection) -> String {
        tasks::create_task(conn, "write", None, None).unwrap().id
    }

    const POMODORO: i64 = 25 * 60;

    #[test]
    fn start_reads_back_running() {
        let mut conn = fresh();
        let t = task(&mut conn);
        let s = start(&conn, Some(&t), FocusKind::Work, POMODORO, at(0)).unwrap();
        assert_eq!(s.task_id.as_deref(), Some(t.as_str()));
        assert_eq!(s.kind, FocusKind::Work);
        assert_eq!(s.started_at, "2026-09-14T09:00:00Z");
        assert_eq!(s.ends_at.as_deref(), Some("2026-09-14T09:25:00Z"));
        assert_eq!(s.remaining_seconds, POMODORO);
        assert!(s.ended_at.is_none() && s.outcome.is_none() && s.paused_at.is_none());
        assert_eq!(s.block_id, None, "no block covers this moment");
    }

    #[test]
    fn start_drops_sub_second_precision() {
        let conn = fresh();
        let now = at(0) + Duration::milliseconds(999);
        let s = start(&conn, None, FocusKind::Work, POMODORO, now).unwrap();
        assert_eq!(s.started_at, "2026-09-14T09:00:00Z");
    }

    #[test]
    fn start_logs_against_the_block_covering_now() {
        let mut conn = fresh();
        let t = task(&mut conn);
        let got = tasks::add_block(
            &mut conn,
            &t,
            "2026-09-14T08:30:00Z",
            "2026-09-14T10:00:00Z",
            None,
        )
        .unwrap();
        let s = start(&conn, Some(&t), FocusKind::Work, POMODORO, at(0)).unwrap();
        assert_eq!(s.block_id.as_deref(), Some(got.blocks[0].id.as_str()));
    }

    #[test]
    fn start_rejects_bad_input() {
        let conn = fresh();
        assert!(matches!(
            start(&conn, Some("nope"), FocusKind::Work, POMODORO, at(0)),
            Err(AppError::NotFound(_))
        ));
        for bad in [0, 59, MAX_PLANNED_SECONDS + 1, -1] {
            assert!(
                matches!(
                    start(&conn, None, FocusKind::Work, bad, at(0)),
                    Err(AppError::Invalid(_))
                ),
                "accepted {bad}"
            );
        }
    }

    #[test]
    fn only_one_session_may_be_open() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        assert!(matches!(
            start(&conn, None, FocusKind::ShortBreak, 300, at(1)),
            Err(AppError::Invalid(_))
        ));
        // The index holds even for a write that skips the Rust check.
        assert!(conn
            .execute(
                "INSERT INTO focus_sessions (id, kind, started_at, planned_seconds)
                 VALUES ('x', 'work', '2026-09-14T09:01:00Z', 60)",
                [],
            )
            .is_err());
    }

    #[test]
    fn remaining_follows_the_clock() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        let s = current(&conn, at(10)).unwrap().unwrap();
        assert_eq!(s.remaining_seconds, 15 * 60);
        assert_eq!(s.elapsed_seconds, 10 * 60);
        assert_eq!(s.ends_at.as_deref(), Some("2026-09-14T09:25:00Z"));
    }

    #[test]
    fn pause_freezes_and_resume_pushes_the_deadline_back() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();

        let paused = pause(&conn, at(10)).unwrap();
        assert_eq!(paused.paused_at.as_deref(), Some("2026-09-14T09:10:00Z"));
        assert_eq!(paused.ends_at, None, "a paused timer has no deadline");

        // Half an hour later — long past the original deadline — nothing moved.
        let later = current(&conn, at(40))
            .unwrap()
            .expect("a paused session never expires");
        assert_eq!(later.remaining_seconds, 15 * 60);

        let resumed = resume(&conn, at(40)).unwrap();
        assert!(resumed.paused_at.is_none());
        assert_eq!(resumed.paused_seconds, 30 * 60);
        assert_eq!(resumed.ends_at.as_deref(), Some("2026-09-14T09:55:00Z"));
        assert_eq!(resumed.remaining_seconds, 15 * 60);
    }

    #[test]
    fn pause_and_resume_are_idempotent() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        pause(&conn, at(5)).unwrap();
        let again = pause(&conn, at(8)).unwrap();
        assert_eq!(
            again.paused_at.as_deref(),
            Some("2026-09-14T09:05:00Z"),
            "the second press did not move the pause point"
        );
        resume(&conn, at(10)).unwrap();
        let again = resume(&conn, at(12)).unwrap();
        assert_eq!(
            again.paused_seconds,
            5 * 60,
            "resume twice counts the pause once"
        );
    }

    #[test]
    fn mutations_without_an_open_session_fail() {
        let conn = fresh();
        assert!(matches!(pause(&conn, at(0)), Err(AppError::NoFocusSession)));
        assert!(matches!(
            resume(&conn, at(0)),
            Err(AppError::NoFocusSession)
        ));
        assert!(matches!(
            log_interruption(&conn, "slack", at(0)),
            Err(AppError::NoFocusSession)
        ));
        assert!(current(&conn, at(0)).unwrap().is_none());
    }

    /// The restart case: the app was closed with a timer running, and opens
    /// again long after it would have rung.
    #[test]
    fn an_overdue_session_completes_at_its_deadline() {
        let conn = fresh();
        let s = start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();

        assert!(current(&conn, at(120)).unwrap().is_none());
        let closed = get(&conn, &s.id, at(120)).unwrap();
        assert_eq!(closed.outcome, Some(FocusOutcome::Completed));
        assert_eq!(closed.ended_at.as_deref(), Some("2026-09-14T09:25:00Z"));
        assert_eq!(
            closed.elapsed_seconds, POMODORO,
            "25 minutes, not two hours"
        );
        assert_eq!(closed.remaining_seconds, 0);
    }

    #[test]
    fn expire_fires_exactly_at_the_deadline_and_only_once() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        assert!(expire(&conn, at(25) - Duration::seconds(1))
            .unwrap()
            .is_none());
        assert!(expire(&conn, at(25)).unwrap().is_some());
        assert!(expire(&conn, at(26)).unwrap().is_none(), "already closed");
    }

    #[test]
    fn finish_records_the_outcome_and_is_idempotent() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        let done = finish(&conn, FocusOutcome::Skipped, at(10))
            .unwrap()
            .unwrap();
        assert_eq!(done.outcome, Some(FocusOutcome::Skipped));
        assert_eq!(done.ended_at.as_deref(), Some("2026-09-14T09:10:00Z"));
        assert_eq!(done.elapsed_seconds, 10 * 60);
        assert_eq!(done.ends_at, None);

        assert!(finish(&conn, FocusOutcome::Skipped, at(11))
            .unwrap()
            .is_none());
        // And the slot is free again.
        assert!(start(&conn, None, FocusKind::ShortBreak, 300, at(11)).is_ok());
    }

    #[test]
    fn finishing_a_run_out_timer_records_completed_whatever_was_asked() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        let done = finish(&conn, FocusOutcome::Abandoned, at(30))
            .unwrap()
            .unwrap();
        assert_eq!(done.outcome, Some(FocusOutcome::Completed));
        assert_eq!(done.ended_at.as_deref(), Some("2026-09-14T09:25:00Z"));
    }

    #[test]
    fn finishing_while_paused_folds_the_pause() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        pause(&conn, at(10)).unwrap();
        let done = finish(&conn, FocusOutcome::Abandoned, at(30))
            .unwrap()
            .unwrap();
        assert!(done.paused_at.is_none());
        assert_eq!(done.paused_seconds, 20 * 60);
        assert_eq!(done.elapsed_seconds, 10 * 60, "the pause is not focus time");
    }

    #[test]
    fn interruptions_attach_to_the_open_session() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        log_interruption(&conn, "  slack ping  ", at(3)).unwrap();
        let s = log_interruption(&conn, "doorbell", at(7)).unwrap();
        let notes: Vec<_> = s.interruptions.iter().map(|i| i.note.as_str()).collect();
        assert_eq!(notes, ["slack ping", "doorbell"]);
        assert_eq!(s.interruptions[0].at, "2026-09-14T09:03:00Z");

        assert!(matches!(
            log_interruption(&conn, "   ", at(8)),
            Err(AppError::Invalid(_))
        ));
    }

    #[test]
    fn pomodoros_done_counts_only_completed_work_on_the_task() {
        let mut conn = fresh();
        let t = task(&mut conn);
        let other = task(&mut conn);

        start(&conn, Some(&t), FocusKind::Work, POMODORO, at(0)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(25)).unwrap();
        start(&conn, Some(&t), FocusKind::ShortBreak, 300, at(25)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(30)).unwrap();
        start(&conn, Some(&t), FocusKind::Work, POMODORO, at(30)).unwrap();
        finish(&conn, FocusOutcome::Skipped, at(40)).unwrap();
        start(&conn, Some(&other), FocusKind::Work, POMODORO, at(40)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(65)).unwrap();

        let listed = tasks::list_tasks(&conn).unwrap();
        let count = |id: &str| listed.iter().find(|x| x.id == id).unwrap().pomodoros_done;
        assert_eq!(count(&t), 1, "the break and the skipped one do not count");
        assert_eq!(count(&other), 1);
        // get_task (via toggle) reads the same column.
        assert_eq!(tasks::toggle_task(&conn, &t).unwrap().pomodoros_done, 1);
    }

    #[test]
    fn deleting_a_task_keeps_its_history() {
        let mut conn = fresh();
        let t = task(&mut conn);
        let s = start(&conn, Some(&t), FocusKind::Work, POMODORO, at(0)).unwrap();
        tasks::delete_task(&conn, &t).unwrap();

        let kept = current(&conn, at(5)).unwrap().expect("still running");
        assert_eq!(kept.id, s.id);
        assert_eq!(kept.task_id, None);
    }

    #[test]
    fn day_sums_the_sessions_in_its_range() {
        let conn = fresh();
        // Yesterday, outside the range.
        start(&conn, None, FocusKind::Work, POMODORO, at(-24 * 60)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(-24 * 60 + 25)).unwrap();
        // Today: one completed, a break, one skipped, one still running.
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(25)).unwrap();
        start(&conn, None, FocusKind::ShortBreak, 300, at(25)).unwrap();
        finish(&conn, FocusOutcome::Completed, at(30)).unwrap();
        start(&conn, None, FocusKind::Work, POMODORO, at(30)).unwrap();
        finish(&conn, FocusOutcome::Skipped, at(40)).unwrap();
        start(&conn, None, FocusKind::Work, POMODORO, at(40)).unwrap();

        let d = day(
            &conn,
            "2026-09-14T00:00:00Z",
            "2026-09-15T00:00:00Z",
            at(45),
        )
        .unwrap();
        assert_eq!(d.sessions.len(), 4);
        assert_eq!(d.pomodoros, 1);
        // 25 + 10 + 5 (running) minutes of work; the break is not focus.
        assert_eq!(d.focused_seconds, 40 * 60);
    }

    #[test]
    fn day_is_half_open() {
        let conn = fresh();
        start(&conn, None, FocusKind::Work, POMODORO, at(0)).unwrap();
        let ends_at_start =
            day(&conn, "2026-09-13T09:00:00Z", "2026-09-14T09:00:00Z", at(1)).unwrap();
        assert!(ends_at_start.sessions.is_empty());
        let starts_at_start =
            day(&conn, "2026-09-14T09:00:00Z", "2026-09-15T09:00:00Z", at(1)).unwrap();
        assert_eq!(starts_at_start.sessions.len(), 1);
    }

    #[test]
    fn day_rejects_a_bad_range() {
        let conn = fresh();
        for (from, to) in [
            ("2026-09-15T00:00:00Z", "2026-09-14T00:00:00Z"),
            ("2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z"),
            ("2026-09-14", "2026-09-15"),
        ] {
            assert!(
                matches!(day(&conn, from, to, at(0)), Err(AppError::Invalid(_))),
                "accepted {from} -> {to}"
            );
        }
    }

    /// Serde and the CHECK constraint must agree on every spelling, or a row
    /// written by one side is unreadable by the other.
    #[test]
    fn enum_spellings_match_serde() {
        use crate::model::TaskStatus;
        for status in [
            TaskStatus::Todo,
            TaskStatus::InProgress,
            TaskStatus::Done,
            TaskStatus::Idea,
            TaskStatus::Blocked,
        ] {
            assert_eq!(
                serde_json::to_value(status).unwrap(),
                serde_json::Value::from(status.as_str())
            );
        }
        for kind in [FocusKind::Work, FocusKind::ShortBreak, FocusKind::LongBreak] {
            assert_eq!(
                serde_json::to_value(kind).unwrap(),
                serde_json::Value::from(kind.as_str())
            );
        }
        for outcome in [
            FocusOutcome::Completed,
            FocusOutcome::Skipped,
            FocusOutcome::Abandoned,
        ] {
            assert_eq!(
                serde_json::to_value(outcome).unwrap(),
                serde_json::Value::from(outcome.as_str())
            );
        }
    }
}
