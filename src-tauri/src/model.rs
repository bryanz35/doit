// Data types go here; will mirror src/types.ts
use crate::AppError;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")] // why kebab case?
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
    Idea,
    Blocked,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Todo => "todo",
            TaskStatus::InProgress => "in-progress",
            TaskStatus::Done => "done",
            TaskStatus::Idea => "idea",
            TaskStatus::Blocked => "blocked",
        }
    }
    pub fn parse(s: &str) -> crate::error::Result<Self> {
        Ok(match s {
            "todo" => TaskStatus::Todo,
            "in-progress" => TaskStatus::InProgress,
            "done" => TaskStatus::Done,
            "idea" => TaskStatus::Idea,
            "blocked" => TaskStatus::Blocked,
            other => return Err(AppError::Invalid(format!("unknown status {other:?}"))),
        })
    }
}

impl ToSql for TaskStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for TaskStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        TaskStatus::parse(s).map_err(|e| FromSqlError::Other(Box::new(e)))
    }
}

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: Option<TaskStatus>,
}
