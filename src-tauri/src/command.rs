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

#[tauri::command]
pub fn create_task(
    db: State<'_, Db>,
    title: String,
    due: Option<String>,
    list: Option<String>,
) -> Result<Task> {
    let mut conn = lock(&db)?;
    tasks::create_task(&mut conn, &title, due.as_deref(), list.as_deref())
}

#[tauri::command]
pub fn update_task(db: State<'_, Db>, id: String, patch: TaskPatch) -> Result<Task> {
    let conn = lock(&db)?;
    tasks::update_task(&conn, &id, &patch)
}
#[tauri::command]
pub fn toggle_task(db: State<'_, Db>, id: String) -> Result<Task> {
    let conn = lock(&db)?;
    tasks::toggle_task(&conn, &id)
}
#[tauri::command]
pub fn delete_task(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = lock(&db)?;
    tasks::delete_task(&conn, &id)
}
#[tauri::command]
pub fn set_task_tags(db: State<'_, Db>, id: String, tags: Vec<String>) -> Result<Task> {
    let mut conn = lock(&db)?;
    tasks::set_task_tags(&mut conn, &id, &tags)
}
#[tauri::command]
pub fn set_task_deps(db: State<'_, Db>, id: String, depends_on: Vec<String>) -> Result<Task> {
    let mut conn = lock(&db)?;
    tasks::set_task_deps(&mut conn, &id, &depends_on)
}
