use crate::error::{AppError, Result};
use crate::model::{Task, TaskPatch, TaskStatus};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        status: row.get("status")?,
        due: row.get("due")?,
        estimate_minutes: row.get("estimate_minutes")?,
        pomodoros: row.get("pomodoros")?,
        list: row.get("list")?,
        repo: row.get("repo")?,
        completed_at: row.get("completed_at")?,
        tags: Vec::new(),
        depends_on: Vec::new(),
    })
}
