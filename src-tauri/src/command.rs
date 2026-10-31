// goal: take connection out of managed state, call into tasks, return to frontend.

use crate::alarm::Alarm;
use crate::db::Db;
use crate::error::{AppError, Result};
use crate::model::{FocusDay, FocusKind, FocusOutcome, FocusSession, Task, TaskPatch};
use crate::{focus, settings, tasks};
use chrono::Utc;
use rusqlite::Connection;
use std::collections::HashMap;
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
#[tauri::command]
pub fn add_block(
    db: State<'_, Db>,
    task_id: String,
    start_at: String,
    end_at: String,
    tz: Option<String>,
) -> Result<Task> {
    let mut conn = lock(&db)?;
    tasks::add_block(&mut conn, &task_id, &start_at, &end_at, tz.as_deref())
}
#[tauri::command]
pub fn update_block(
    db: State<'_, Db>,
    block_id: String,
    start_at: String,
    end_at: String,
    tz: Option<String>,
) -> Result<Task> {
    let mut conn = lock(&db)?;
    tasks::update_block(&mut conn, &block_id, &start_at, &end_at, tz.as_deref())
}
#[tauri::command]
pub fn delete_block(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = lock(&db)?;
    tasks::delete_block(&conn, &id)
}

// ---- focus ----
//
// Every command that can move the deadline reports the session it returns to
// the alarm, which re-arms or disarms itself from it.

#[tauri::command]
pub fn current_focus(db: State<'_, Db>, alarm: State<'_, Alarm>) -> Result<Option<FocusSession>> {
    let conn = lock(&db)?;
    let session = focus::current(&conn, Utc::now())?;
    alarm.follow(session.as_ref());
    Ok(session)
}
#[tauri::command]
pub fn start_focus(
    db: State<'_, Db>,
    alarm: State<'_, Alarm>,
    task_id: Option<String>,
    kind: FocusKind,
    planned_seconds: i64,
) -> Result<FocusSession> {
    let conn = lock(&db)?;
    let session = focus::start(&conn, task_id.as_deref(), kind, planned_seconds, Utc::now())?;
    alarm.follow(Some(&session));
    Ok(session)
}
#[tauri::command]
pub fn pause_focus(db: State<'_, Db>, alarm: State<'_, Alarm>) -> Result<FocusSession> {
    let conn = lock(&db)?;
    let session = focus::pause(&conn, Utc::now())?;
    alarm.follow(Some(&session));
    Ok(session)
}
#[tauri::command]
pub fn resume_focus(db: State<'_, Db>, alarm: State<'_, Alarm>) -> Result<FocusSession> {
    let conn = lock(&db)?;
    let session = focus::resume(&conn, Utc::now())?;
    alarm.follow(Some(&session));
    Ok(session)
}
#[tauri::command]
pub fn finish_focus(
    db: State<'_, Db>,
    alarm: State<'_, Alarm>,
    outcome: FocusOutcome,
) -> Result<Option<FocusSession>> {
    let conn = lock(&db)?;
    let session = focus::finish(&conn, outcome, Utc::now())?;
    alarm.follow(None);
    Ok(session)
}
#[tauri::command]
pub fn log_interruption(db: State<'_, Db>, note: String) -> Result<FocusSession> {
    let conn = lock(&db)?;
    focus::log_interruption(&conn, &note, Utc::now())
}
#[tauri::command]
pub fn focus_day(db: State<'_, Db>, from: String, to: String) -> Result<FocusDay> {
    let conn = lock(&db)?;
    focus::day(&conn, &from, &to, Utc::now())
}

// ---- settings ----

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<HashMap<String, String>> {
    let conn = lock(&db)?;
    settings::get_settings(&conn)
}
#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: Option<String>) -> Result<()> {
    let conn = lock(&db)?;
    settings::set_setting(&conn, &key, value.as_deref())
}
