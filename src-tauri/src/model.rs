// Data types go here; will mirror src/types.ts
use crate::AppError;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// `as_str`/`parse` and the rusqlite conversions for a kebab-case enum. The
/// spellings repeat serde's `rename_all`; `focus::tests::enum_spellings_match_serde`
/// keeps the two in step.
macro_rules! sql_enum {
    ($name:ident, $what:literal { $($variant:ident => $text:literal),+ $(,)? }) => {
        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $($name::$variant => $text,)+
                }
            }
            pub fn parse(s: &str) -> crate::error::Result<Self> {
                Ok(match s {
                    $($text => $name::$variant,)+
                    other => {
                        return Err(AppError::Invalid(format!(concat!("unknown ", $what, " {:?}"), other)))
                    }
                })
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.as_str()))
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                $name::parse(value.as_str()?).map_err(|e| FromSqlError::Other(Box::new(e)))
            }
        }
    };
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")] // why kebab case?
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
    Idea,
    Blocked,
}

sql_enum!(TaskStatus, "status" {
    Todo => "todo",
    InProgress => "in-progress",
    Done => "done",
    Idea => "idea",
    Blocked => "blocked",
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimate_minutes: Option<i64>, //estimateMinutes in ts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pomodoros: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list: Option<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub depends_on: Vec<String>,
    /// Completed work sessions logged against this task — counted from
    /// `focus_sessions` on every read, never stored, so it cannot drift from the
    /// log. `pomodoros` above is the estimate; this is the actual.
    pub pomodoros_done: i64,
    /// Calendar blocks, ordered by start. Always present, empty when the task
    /// has never been scheduled — the frontend never has to test for undefined.
    pub blocks: Vec<TaskBlock>,
}

/// One scheduled span of work on a task, as stored in `task_blocks`.
///
/// `start_at`/`end_at` are UTC instants spelled exactly `YYYY-MM-DDTHH:MM:SSZ`
/// (see `tasks::check_instant`) — the schema's CHECK compares them as strings,
/// so the spelling is load-bearing, not cosmetic. `tz` is the IANA zone the
/// block was authored in, kept for calendar export; `None` means floating.
///
/// Read-only shape: the backend mints ids, so there is no input twin of this
/// struct. `add_block` takes its fields as arguments and `update_block`
/// replaces the whole span, which is what a drag or resize produces anyway.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBlock {
    pub id: String,
    pub task_id: String,
    pub start_at: String,
    pub end_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,
}

/// Partial update for a task: every field is `None` for "leave this column
/// alone". Deserialized straight from the frontend's patch object, so the
/// camelCase rename has to match `TaskPatch` in src/types.ts.
///
/// Note the consequence of the COALESCE-based UPDATE in `tasks::update_task`:
/// a `None` means "unchanged", so this cannot express "clear this column back
/// to NULL". If clearing is ever needed, the field has to become
/// `Option<Option<T>>` with `#[serde(default, deserialize_with = ...)]` to tell
/// an absent key apart from an explicit `null`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: Option<TaskStatus>,
    pub due: Option<String>,
    pub estimate_minutes: Option<i64>,
}

/// What a focus session is for. Kebab-case on the wire and in the CHECK
/// constraint, like `TaskStatus`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum FocusKind {
    Work,
    ShortBreak,
    LongBreak,
}

sql_enum!(FocusKind, "focus kind" {
    Work => "work",
    ShortBreak => "short-break",
    LongBreak => "long-break",
});

/// How a session ended. `Completed` is the only outcome that counts as a
/// pomodoro; the timer running out always records it, whatever the caller asked.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum FocusOutcome {
    Completed,
    Skipped,
    Abandoned,
}

sql_enum!(FocusOutcome, "focus outcome" {
    Completed => "completed",
    Skipped => "skipped",
    Abandoned => "abandoned",
});

/// One pomodoro or break, as stored in `focus_sessions`, plus the fields
/// derived from its instants at read time.
///
/// All instants are UTC `YYYY-MM-DDTHH:MM:SSZ`. The stored fields say what
/// happened; the derived ones say where the clock is *now*, and are only as
/// fresh as the read — the frontend should count down from `ends_at`, not
/// from `remaining_seconds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    pub kind: FocusKind,
    pub started_at: String,
    pub planned_seconds: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<String>,
    pub paused_seconds: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<FocusOutcome>,

    /// Derived: when the timer runs out. Present only while it is running —
    /// a paused or ended session has no deadline.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
    /// Derived: seconds left, frozen while paused, 0 once ended or overdue.
    pub remaining_seconds: i64,
    /// Derived: seconds actually spent, excluding pauses, capped at
    /// `planned_seconds`. What the day's "focused" total sums.
    pub elapsed_seconds: i64,
    /// Ordered by time.
    pub interruptions: Vec<FocusInterruption>,
}

/// A distraction noted during a session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusInterruption {
    pub id: String,
    pub session_id: String,
    pub at: String,
    pub note: String,
}

/// The sessions started in one range — the frontend sends a local day as two
/// UTC instants — and what they add up to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusDay {
    pub from: String,
    pub to: String,
    /// Completed work sessions.
    pub pomodoros: i64,
    /// Sum of `elapsed_seconds` over work sessions of any outcome, including
    /// the open one up to now.
    pub focused_seconds: i64,
    /// Ordered by start.
    pub sessions: Vec<FocusSession>,
}
