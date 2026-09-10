// goal: take connection out of managed state, call into tasks, return to frontend.

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::model::{Task, TaskPatch};
use crate::tasks;
use rusqlite::Connection;
use std::sync::MutexGuard;
use tauri::State;

fn lock<'a>(db: &'a State<'_, Db>) -> Result<MutexGuard<'a, Connection>> {
    db.0.lock().map_err(|_| AppError::Lock)
}

#[tauri::command]
pub fn list_tasks(db: State<'_, Db>) -> Result<Vec<Task>> {
    let conn = lock(&db)?;
    tasks::list_tasks(&conn)
}
