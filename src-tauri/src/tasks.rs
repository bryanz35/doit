use crate::error::{AppError, Result};
use crate::model::{Task, TaskPatch};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;

/// Every column `row_to_task` reads, in one place. `row_to_task` looks columns
/// up by name, so any SELECT feeding it must list all of these.
const TASK_COLUMNS: &str =
    "id, title, notes, status, due, estimate_minutes, pomodoros, list, repo, completed_at";

/// SQLite has no date type; the schema documents `due` as an ISO `YYYY-MM-DD`
/// string and nothing enforces it, so check it on the way in.
fn check_due(due: Option<&str>) -> Result<()> {
    if let Some(d) = due {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| AppError::Invalid(format!("due must be YYYY-MM-DD, got {d:?}")))?;
    }
    Ok(())
}

pub fn create_task(
    conn: &mut Connection,
    title: &str,
    due: Option<&str>,
    list: Option<&str>,
) -> Result<Task> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("Title must not be empty".into()));
    }
    check_due(due)?;
    let id = uuid::Uuid::new_v4().to_string();

    let tx = conn.transaction()?;
    let sort_order: f64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks",
        [],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO tasks (id, title, status, due, list, sort_order)
        VALUES (?1, ?2, 'todo', ?3, ?4, ?5)",
        params![id, title, due, list, sort_order],
    )?;
    tx.commit()?;

    get_task(conn, &id)
}

pub fn update_task(conn: &Connection, id: &str, patch: &TaskPatch) -> Result<Task> {
    check_due(patch.due.as_deref())?;

    // Each column is COALESCE(?n, column): a NULL parameter leaves it alone.
    // completed_at is derived from the status transition instead — stamped when
    // the task becomes done, cleared when it moves back out of done, untouched
    // when the patch says nothing about status.
    let n = conn.execute(
        "UPDATE tasks SET
            title            = COALESCE(?1, title),
            notes            = COALESCE(?2, notes),
            status           = COALESCE(?3, status),
            due              = COALESCE(?4, due),
            estimate_minutes = COALESCE(?5, estimate_minutes),
            completed_at     = CASE
                WHEN ?3 IS NULL   THEN completed_at
                WHEN ?3 = 'done'  THEN COALESCE(completed_at,
                                       strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                ELSE NULL
            END
        WHERE id = ?6",
        params![
            patch.title,
            patch.notes,
            patch.status,
            patch.due,
            patch.estimate_minutes,
            id
        ],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(id.to_string()));
    }
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(AppError::NotFound(id.to_string()));
    }
    Ok(())
}

pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>> {
    // Two extra queries for the whole table rather than two per task.
    let mut tags = collect_pairs(conn, "SELECT task_id, tag FROM task_tags ORDER BY tag")?;
    let mut deps = collect_pairs(
        conn,
        "SELECT task_id, depends_on_id FROM task_deps ORDER BY depends_on_id",
    )?;
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY sort_order, created_at");
    let mut tmp = conn.prepare(&sql)?;
    let rows = tmp.query_map([], row_to_task)?;
    let mut tasks = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    for task in &mut tasks {
        task.tags = tags.remove(&task.id).unwrap_or_default();
        task.depends_on = deps.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

fn collect_pairs(conn: &Connection, sql: &str) -> Result<HashMap<String, Vec<String>>> {
    let mut tmp = conn.prepare(sql)?;
    let rows = tmp.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;

    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        map.entry(key).or_default().push(value);
    }
    Ok(map)
}

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

fn get_task(conn: &Connection, id: &str) -> Result<Task> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1");
    let mut task = conn
        .query_row(&sql, params![id], row_to_task)
        .optional()?
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    task.tags = tags_for(conn, id)?;
    task.depends_on = deps_for(conn, id)?;
    Ok(task)
}

fn tags_for(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut tmp = conn.prepare("SELECT tag FROM task_tags WHERE task_id = ?1 ORDER BY tag")?;
    let rows = tmp.query_map(params![id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// One row per edge, so a task with three dependencies is three rows — the
/// primary key of task_deps is (task_id, depends_on_id).
fn deps_for(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut tmp = conn
        .prepare("SELECT depends_on_id FROM task_deps WHERE task_id = ?1 ORDER BY depends_on_id")?;
    let rows = tmp.query_map(params![id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::model::TaskStatus;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn create_reads_back() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "  write tests  ", Some("2026-09-10"), Some("work")).unwrap();
        assert_eq!(t.title, "write tests");
        assert_eq!(t.status, TaskStatus::Todo);
        assert_eq!(t.due.as_deref(), Some("2026-09-10"));
        assert_eq!(t.list.as_deref(), Some("work"));
        assert!(t.tags.is_empty() && t.depends_on.is_empty());
    }

    #[test]
    fn create_rejects_bad_input() {
        let mut conn = fresh();
        assert!(create_task(&mut conn, "   ", None, None).is_err());
        assert!(create_task(&mut conn, "ok", Some("09/10/2026"), None).is_err());
    }

    #[test]
    fn create_increments_sort_order() {
        let mut conn = fresh();
        create_task(&mut conn, "first", None, None).unwrap();
        create_task(&mut conn, "second", None, None).unwrap();
        let titles: Vec<_> = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .map(|t| t.title)
            .collect();
        assert_eq!(titles, ["first", "second"]);
    }

    #[test]
    fn update_patches_only_named_fields() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "old", Some("2026-09-10"), None).unwrap();
        let patch = TaskPatch {
            title: Some("new".into()),
            estimate_minutes: Some(45),
            ..Default::default()
        };
        let updated = update_task(&conn, &t.id, &patch).unwrap();
        assert_eq!(updated.title, "new");
        assert_eq!(updated.estimate_minutes, Some(45));
        assert_eq!(updated.due.as_deref(), Some("2026-09-10")); // untouched
        assert_eq!(updated.status, TaskStatus::Todo);
    }

    #[test]
    fn completed_at_tracks_done_transition() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "ship", None, None).unwrap();
        assert!(t.completed_at.is_none());

        let done = update_task(
            &conn,
            &t.id,
            &TaskPatch {
                status: Some(TaskStatus::Done),
                ..Default::default()
            },
        )
        .unwrap();
        let stamp = done.completed_at.clone().expect("stamped on done");

        // A patch that says nothing about status must not disturb the stamp.
        let renamed = update_task(
            &conn,
            &t.id,
            &TaskPatch {
                title: Some("ship it".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.completed_at.as_ref(), Some(&stamp));

        let reopened = update_task(
            &conn,
            &t.id,
            &TaskPatch {
                status: Some(TaskStatus::Todo),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(reopened.completed_at.is_none());
    }

    #[test]
    fn tags_and_deps_come_back_on_the_task() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        let c = create_task(&mut conn, "c", None, None).unwrap();
        conn.execute(
            "INSERT INTO task_tags (task_id, tag) VALUES (?1, 'rust'), (?1, 'db')",
            params![a.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_deps (task_id, depends_on_id) VALUES (?1, ?2), (?1, ?3)",
            params![a.id, b.id, c.id],
        )
        .unwrap();

        let got = get_task(&conn, &a.id).unwrap();
        assert_eq!(got.tags, ["db", "rust"]);
        assert_eq!(got.depends_on.len(), 2);

        // list_tasks must attach the same thing it does one at a time.
        let listed = list_tasks(&conn).unwrap();
        let a_listed = listed.iter().find(|t| t.id == a.id).unwrap();
        assert_eq!(a_listed.tags, ["db", "rust"]);
        assert_eq!(a_listed.depends_on, got.depends_on);
    }

    #[test]
    fn delete_cascades_and_reports_missing() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        conn.execute(
            "INSERT INTO task_tags (task_id, tag) VALUES (?1, 'rust')",
            params![a.id],
        )
        .unwrap();

        delete_task(&conn, &a.id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);

        assert!(matches!(
            delete_task(&conn, &a.id),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            update_task(&conn, "nope", &TaskPatch::default()),
            Err(AppError::NotFound(_))
        ));
    }
}
