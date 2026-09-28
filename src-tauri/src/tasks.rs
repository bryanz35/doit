use crate::error::{AppError, Result};
use crate::model::{Task, TaskBlock, TaskPatch};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};

/// Every column `row_to_task` reads, in one place. `row_to_task` looks columns
/// up by name, so any SELECT feeding it must list all of these.
const TASK_COLUMNS: &str =
    "id, title, notes, status, due, estimate_minutes, pomodoros, list, repo, completed_at";

/// Same contract as TASK_COLUMNS, for `row_to_block`.
const BLOCK_COLUMNS: &str = "id, task_id, start_at, end_at, tz";

/// SQLite has no date type; the schema documents `due` as an ISO `YYYY-MM-DD`
/// string and nothing enforces it, so check it on the way in.
fn check_due(due: Option<&str>) -> Result<()> {
    if let Some(d) = due {
        let parsed = chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| AppError::Invalid(format!("due must be YYYY-MM-DD, received {d:?}")))?;
        if parsed.format("%Y-%m-%d").to_string() != d {
            return Err(AppError::Invalid(format!(
                "due must be zero-padded YYYY-MM-DD, received {d:?}"
            )));
        }
    }
    Ok(())
}

/// The one spelling `task_blocks.start_at` / `end_at` may hold: a UTC instant
/// as `YYYY-MM-DDTHH:MM:SSZ`, fixed width, no fractional seconds, no `+00:00`.
///
/// This is stricter than "a valid RFC3339 timestamp" on purpose. The schema's
/// `CHECK (end_at > start_at)`, every `ORDER BY start_at`, and the overlap test
/// in `check_no_overlap` are all *string* comparisons, and those are only
/// equivalent to comparing instants while every row is spelled identically.
/// Accepting `2026-09-14T09:00:00-07:00` would store a correct instant that
/// sorts and compares wrongly against its neighbours, so it is rejected here
/// and the frontend normalizes to Z before sending.
///
/// The round-trip re-format is the same trick `check_due` uses for zero padding:
/// parse, print canonically, and insist the input already said that.
fn check_instant(value: &str) -> Result<chrono::DateTime<chrono::Utc>> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| AppError::Invalid(format!("timestamp must be RFC3339, received {value:?}")))?
        .with_timezone(&chrono::Utc);
    if parsed.format("%Y-%m-%dT%H:%M:%SZ").to_string() != value {
        return Err(AppError::Invalid(format!(
            "timestamp must be UTC as YYYY-MM-DDTHH:MM:SSZ, received {value:?}"
        )));
    }
    Ok(parsed)
}

/// Both ends valid and the span non-empty. The schema repeats the ordering
/// check, but only as a string compare it cannot justify on its own — this is
/// where the error message the user sees comes from.
fn check_span(start_at: &str, end_at: &str) -> Result<()> {
    let start = check_instant(start_at)?;
    let end = check_instant(end_at)?;
    if end <= start {
        return Err(AppError::Invalid(format!(
            "block must end after it starts, received {start_at} -> {end_at}"
        )));
    }
    Ok(())
}

/// Two blocks on the *same* task may not cover the same minute — the user
/// cannot sit down to one task twice at once, and a calendar that renders it
/// has nothing sensible to draw. Blocks on *different* tasks are free to
/// overlap: double-booking yourself is real, and the grid should show it.
///
/// `except` is the block being moved, so a resize does not collide with its own
/// old row. Half-open intervals: touching end-to-start is not an overlap.
fn check_no_overlap(
    conn: &Connection,
    task_id: &str,
    start_at: &str,
    end_at: &str,
    except: Option<&str>,
) -> Result<()> {
    let clash: Option<String> = conn
        .query_row(
            "SELECT id FROM task_blocks
             WHERE task_id = ?1
               AND id IS NOT ?2
               AND start_at < ?4
               AND end_at   > ?3
             LIMIT 1",
            params![task_id, except, start_at, end_at],
            |r| r.get(0),
        )
        .optional()?;
    match clash {
        Some(_) => Err(AppError::Invalid(format!(
            "block {start_at} -> {end_at} overlaps another block on this task"
        ))),
        None => Ok(()),
    }
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
    let mut blocks = collect_blocks(conn)?;
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY sort_order, created_at");
    let mut tmp = conn.prepare(&sql)?;
    let rows = tmp.query_map([], row_to_task)?;
    let mut tasks = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    for task in &mut tasks {
        task.tags = tags.remove(&task.id).unwrap_or_default();
        task.depends_on = deps.remove(&task.id).unwrap_or_default();
        task.blocks = blocks.remove(&task.id).unwrap_or_default();
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

/// The blocks for every task at once, same reason as `collect_pairs`: one query
/// for the table instead of one per task. Not `collect_pairs` itself because
/// the value is a struct, not a string.
fn collect_blocks(conn: &Connection) -> Result<HashMap<String, Vec<TaskBlock>>> {
    let sql = format!("SELECT {BLOCK_COLUMNS} FROM task_blocks ORDER BY start_at, id");
    let mut tmp = conn.prepare(&sql)?;
    let rows = tmp.query_map([], row_to_block)?;

    let mut map: HashMap<String, Vec<TaskBlock>> = HashMap::new();
    for row in rows {
        let block = row?;
        map.entry(block.task_id.clone()).or_default().push(block);
    }
    Ok(map)
}

// constructs a task object with data from sql table, tags and dependencies filled in later
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
        blocks: Vec::new(),
    })
}

fn row_to_block(row: &Row) -> rusqlite::Result<TaskBlock> {
    Ok(TaskBlock {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        start_at: row.get("start_at")?,
        end_at: row.get("end_at")?,
        tz: row.get("tz")?,
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
    task.blocks = blocks_for(conn, id)?;
    Ok(task)
}

fn tags_for(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut tmp = conn.prepare("SELECT tag FROM task_tags WHERE task_id = ?1 ORDER BY tag")?;
    let rows = tmp.query_map(params![id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Ordered by start so the calendar can render the list as it arrives; `id`
/// breaks ties only to keep the order stable between reads.
fn blocks_for(conn: &Connection, id: &str) -> Result<Vec<TaskBlock>> {
    let sql =
        format!("SELECT {BLOCK_COLUMNS} FROM task_blocks WHERE task_id = ?1 ORDER BY start_at, id");
    let mut tmp = conn.prepare(&sql)?;
    let rows = tmp.query_map(params![id], row_to_block)?;
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

pub fn toggle_task(conn: &Connection, id: &str) -> Result<Task> {
    // the status in second CASE is still the original value (not a bug)
    let n = conn.execute(
        "UPDATE tasks SET status = CASE WHEN status = 'done' then 'todo' ELSE 'done' END,
        completed_at = CASE when status = 'done' THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%SZ', 'now') END
        WHERE id = ?1",
        params![id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(id.to_string()));
    }
    get_task(conn, id)
}
// transaction is exclusive so &mut Connection (exclusive borrow)
pub fn set_task_tags(conn: &mut Connection, id: &str, tags: &[String]) -> Result<Task> {
    // sort -> dedup clears repeated elements (note: read github later its super cool)
    let mut cleaned: Vec<&str> = tags
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect();
    cleaned.sort_unstable();
    cleaned.dedup();
    let tx = conn.transaction()?;

    tx.query_row("Select 1 FROM tasks Where id = ?1", params![id], |_| Ok(()))
        .optional()?
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    tx.execute("DELETE FROM task_tags WHERE task_id = ?1", params![id])?;
    {
        let mut tmp = tx.prepare("INSERT INTO task_tags (task_id, tag) VALUES (?1, ?2)")?;
        for tag in &cleaned {
            tmp.execute(params![id, tag])?;
        }
    }
    tx.commit()?;
    get_task(conn, id)
}

pub fn set_task_deps(conn: &mut Connection, id: &str, depends_on: &[String]) -> Result<Task> {
    let mut cleaned: Vec<&str> = depends_on
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    cleaned.sort_unstable();
    cleaned.dedup();
    if cleaned.iter().any(|d| *d == id) {
        return Err(AppError::Invalid("A task cannot depend on itself".into()));
    }
    let tx = conn.transaction()?;
    tx.query_row("SELECT 1 FROM tasks WHERE id = ?1", params![id], |_| Ok(()))
        .optional()?
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    tx.execute("DELETE FROM task_deps WHERE task_id = ?1", params![id])?;
    {
        let mut tmp =
            tx.prepare("INSERT INTO task_deps (task_id, depends_on_id) VALUES (?1, ?2)")?;
        for dep in &cleaned {
            tmp.execute(params![id, dep])?;
        }
    }
    let edges = collect_pairs(&tx, "SELECT task_id, depends_on_id FROM task_deps")?;
    if reaches(&edges, id, id) {
        return Err(AppError::Invalid(format!(
            "Cycle in dependencies: {id} depends on itself"
        )));
    }
    tx.commit()?;
    get_task(conn, id)
}
fn reaches(edges: &HashMap<String, Vec<String>>, from: &str, to: &str) -> bool {
    let mut stack: Vec<&str> = edges
        .get(from)
        .into_iter()
        .flatten()
        .map(String::as_str)
        .collect();
    let mut seen: HashSet<&str> = HashSet::new();
    while let Some(node) = stack.pop() {
        if node == to {
            return true;
        }
        if !seen.insert(node) {
            continue;
        }
        stack.extend(edges.get(node).into_iter().flatten().map(String::as_str));
    }
    false
}

// ---- calendar blocks ----
//
// Three narrow mutations rather than one `set_task_blocks(id, &[...])` replace.
// The replace shape would match set_task_tags/set_task_deps, but those hold
// values with no identity of their own; a block does. Deleting and reinserting
// the set would churn ids on every drag, and the focus timer is meant to log
// sessions against a block — a reference that cannot survive that churn.
//
// add/update return the whole `Task`, like every other mutation here, so the
// store folds one authoritative row back into state; delete returns `()` like
// `delete_task`, since the caller already knows which block it dropped.

/// Schedule a new span of work on a task. The id is minted here; the caller
/// sends only the span, which is all a drag onto the grid produces.
pub fn add_block(
    conn: &mut Connection,
    task_id: &str,
    start_at: &str,
    end_at: &str,
    tz: Option<&str>,
) -> Result<Task> {
    check_span(start_at, end_at)?;
    let id = uuid::Uuid::new_v4().to_string();

    let tx = conn.transaction()?;
    // The foreign key would catch a missing task, but as a constraint error
    // spelled in SQLite's words. Check first so the frontend gets NotFound.
    tx.query_row(
        "SELECT 1 FROM tasks WHERE id = ?1",
        params![task_id],
        |_| Ok(()),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(task_id.to_string()))?;
    check_no_overlap(&tx, task_id, start_at, end_at, None)?;
    tx.execute(
        "INSERT INTO task_blocks (id, task_id, start_at, end_at, tz)
        VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, task_id, start_at, end_at, tz],
    )?;
    tx.commit()?;

    get_task(conn, task_id)
}

/// Move or resize a block. Unlike `TaskPatch` this replaces the whole span
/// rather than patching named fields: a drag or a resize always knows both
/// ends, and a half-specified span could not be validated against the CHECK
/// without reading the row back first. `tz` is written as given, so passing
/// `None` clears it to floating.
///
/// The block keeps its id and its task — a block cannot be moved between tasks
/// here; delete it and add one on the other task.
pub fn update_block(
    conn: &mut Connection,
    block_id: &str,
    start_at: &str,
    end_at: &str,
    tz: Option<&str>,
) -> Result<Task> {
    check_span(start_at, end_at)?;

    let tx = conn.transaction()?;
    let task_id: String = tx
        .query_row(
            "SELECT task_id FROM task_blocks WHERE id = ?1",
            params![block_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::BlockNotFound(block_id.to_string()))?;
    // Exclude this block, or resizing it would always collide with its own row.
    check_no_overlap(&tx, &task_id, start_at, end_at, Some(block_id))?;
    tx.execute(
        "UPDATE task_blocks SET start_at = ?2, end_at = ?3, tz = ?4 WHERE id = ?1",
        params![block_id, start_at, end_at, tz],
    )?;
    tx.commit()?;

    get_task(conn, &task_id)
}

/// Unschedule one block. The task itself is untouched — dropping every block is
/// how a task goes back to the calendar tray.
pub fn delete_block(conn: &Connection, block_id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM task_blocks WHERE id = ?1", params![block_id])?;
    if n == 0 {
        return Err(AppError::BlockNotFound(block_id.to_string()));
    }
    Ok(())
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
        let t = create_task(
            &mut conn,
            "  write tests  ",
            Some("2026-09-10"),
            Some("work"),
        )
        .unwrap();
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

    // ---- toggle_task ----

    #[test]
    fn toggle_flips_status_and_stamps_completed_at() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "ship", None, None).unwrap();

        let done = toggle_task(&conn, &t.id).unwrap();
        assert_eq!(done.status, TaskStatus::Done);
        let stamp = done
            .completed_at
            .clone()
            .expect("stamped on the way to done");

        let reopened = toggle_task(&conn, &t.id).unwrap();
        assert_eq!(reopened.status, TaskStatus::Todo);
        assert!(reopened.completed_at.is_none(), "stamp cleared on reopen");

        // A third toggle re-stamps rather than reusing the old value.
        let done_again = toggle_task(&conn, &t.id).unwrap();
        assert!(done_again.completed_at.is_some());
        let _ = stamp;
    }

    /// Anything that is not 'done' toggles *to* done — the CASE has no third arm.
    #[test]
    fn toggle_completes_a_task_that_was_in_progress() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "wip", None, None).unwrap();
        update_task(
            &conn,
            &t.id,
            &TaskPatch {
                status: Some(TaskStatus::InProgress),
                ..Default::default()
            },
        )
        .unwrap();

        let done = toggle_task(&conn, &t.id).unwrap();
        assert_eq!(done.status, TaskStatus::Done);
        assert!(done.completed_at.is_some());
    }

    #[test]
    fn toggle_reports_missing() {
        let conn = fresh();
        assert!(matches!(
            toggle_task(&conn, "nope"),
            Err(AppError::NotFound(_))
        ));
    }

    // ---- set_task_tags ----

    #[test]
    fn set_tags_trims_dedups_and_sorts() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "a", None, None).unwrap();

        let got = set_task_tags(
            &mut conn,
            &t.id,
            &[
                "  rust  ".into(),
                "rust".into(),
                "db".into(),
                "   ".into(),
                String::new(),
            ],
        )
        .unwrap();
        assert_eq!(got.tags, ["db", "rust"]);
    }

    /// The write is a replace, not a merge: the old rows go.
    #[test]
    fn set_tags_replaces_the_whole_set() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "a", None, None).unwrap();
        set_task_tags(&mut conn, &t.id, &["rust".into(), "db".into()]).unwrap();

        let got = set_task_tags(&mut conn, &t.id, &["ci".into()]).unwrap();
        assert_eq!(got.tags, ["ci"]);
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "replaced, not merged");
    }

    #[test]
    fn set_tags_clears_with_an_empty_slice() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "a", None, None).unwrap();
        set_task_tags(&mut conn, &t.id, &["rust".into()]).unwrap();

        let got = set_task_tags(&mut conn, &t.id, &[]).unwrap();
        assert!(got.tags.is_empty());
    }

    /// The existence check runs before the DELETE, and the failure rolls the
    /// transaction back — a missing id must not touch another task's rows.
    #[test]
    fn set_tags_reports_missing_and_writes_nothing() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "a", None, None).unwrap();
        set_task_tags(&mut conn, &t.id, &["rust".into()]).unwrap();

        assert!(matches!(
            set_task_tags(&mut conn, "nope", &["ci".into()]),
            Err(AppError::NotFound(_))
        ));
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    // ---- set_task_deps ----

    #[test]
    fn set_deps_dedups_and_replaces() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        let c = create_task(&mut conn, "c", None, None).unwrap();

        let got = set_task_deps(
            &mut conn,
            &a.id,
            &[
                b.id.clone(),
                b.id.clone(),
                format!("  {}  ", c.id),
                String::new(),
            ],
        )
        .unwrap();
        let mut want = vec![b.id.clone(), c.id.clone()];
        want.sort();
        assert_eq!(got.depends_on, want);

        let got = set_task_deps(&mut conn, &a.id, &[b.id.clone()]).unwrap();
        assert_eq!(got.depends_on, [b.id.clone()]);
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_deps", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "replaced, not merged");
    }

    #[test]
    fn set_deps_rejects_a_self_edge() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        assert!(matches!(
            set_task_deps(&mut conn, &a.id, &[a.id.clone()]),
            Err(AppError::Invalid(_))
        ));
    }

    /// The schema's CHECK only blocks self-edges; A -> B -> C -> A is Rust's job.
    #[test]
    fn set_deps_rejects_a_longer_cycle_and_rolls_back() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        let c = create_task(&mut conn, "c", None, None).unwrap();
        let d = create_task(&mut conn, "d", None, None).unwrap();

        // a -> b -> c, plus a harmless existing edge on c we expect to survive.
        set_task_deps(&mut conn, &a.id, &[b.id.clone()]).unwrap();
        set_task_deps(&mut conn, &b.id, &[c.id.clone()]).unwrap();
        set_task_deps(&mut conn, &c.id, &[d.id.clone()]).unwrap();

        // Closing the loop c -> a must be refused.
        assert!(matches!(
            set_task_deps(&mut conn, &c.id, &[a.id.clone()]),
            Err(AppError::Invalid(_))
        ));
        assert_eq!(
            get_task(&conn, &c.id).unwrap().depends_on,
            [d.id.clone()],
            "the rejected write rolled back"
        );
    }

    /// A diamond is not a cycle: the check must not reject a re-converging graph.
    #[test]
    fn set_deps_allows_a_diamond() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        let c = create_task(&mut conn, "c", None, None).unwrap();
        let d = create_task(&mut conn, "d", None, None).unwrap();

        set_task_deps(&mut conn, &b.id, &[d.id.clone()]).unwrap();
        set_task_deps(&mut conn, &c.id, &[d.id.clone()]).unwrap();
        let got = set_task_deps(&mut conn, &a.id, &[b.id.clone(), c.id.clone()]).unwrap();
        assert_eq!(got.depends_on.len(), 2);
    }

    #[test]
    fn set_deps_clears_with_an_empty_slice() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        set_task_deps(&mut conn, &a.id, &[b.id.clone()]).unwrap();

        let got = set_task_deps(&mut conn, &a.id, &[]).unwrap();
        assert!(got.depends_on.is_empty());
    }

    #[test]
    fn set_deps_reports_missing_task() {
        let mut conn = fresh();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        assert!(matches!(
            set_task_deps(&mut conn, "nope", &[b.id.clone()]),
            Err(AppError::NotFound(_))
        ));
    }

    /// Deleting a task takes its edges with it, in both directions.
    #[test]
    fn delete_cascades_to_deps_both_ways() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        set_task_deps(&mut conn, &a.id, &[b.id.clone()]).unwrap();

        delete_task(&conn, &b.id).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_deps", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        assert!(get_task(&conn, &a.id).unwrap().depends_on.is_empty());
    }

    // ---- calendar blocks ----

    const T9: &str = "2026-09-14T09:00:00Z";
    const T10: &str = "2026-09-14T10:00:00Z";
    const T11: &str = "2026-09-14T11:00:00Z";
    const T12: &str = "2026-09-14T12:00:00Z";

    #[test]
    fn add_block_reads_back_on_the_task() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();

        let got = add_block(&mut conn, &t.id, T9, T10, Some("America/Los_Angeles")).unwrap();
        assert_eq!(got.blocks.len(), 1);
        let b = &got.blocks[0];
        assert_eq!(b.task_id, t.id);
        assert_eq!(b.start_at, T9);
        assert_eq!(b.end_at, T10);
        assert_eq!(b.tz.as_deref(), Some("America/Los_Angeles"));
        assert!(!b.id.is_empty());
    }

    #[test]
    fn a_task_holds_many_blocks_ordered_by_start() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        add_block(&mut conn, &t.id, T11, T12, None).unwrap();
        let got = add_block(&mut conn, &t.id, T9, T10, None).unwrap();

        let starts: Vec<_> = got.blocks.iter().map(|b| b.start_at.as_str()).collect();
        assert_eq!(starts, [T9, T11], "sorted by start, not insertion order");

        // list_tasks must attach the same thing get_task does.
        let listed = list_tasks(&conn).unwrap();
        assert_eq!(listed[0].blocks, got.blocks);
    }

    #[test]
    fn a_task_with_no_blocks_has_an_empty_vec() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "unscheduled", None, None).unwrap();
        assert!(t.blocks.is_empty());
        assert!(list_tasks(&conn).unwrap()[0].blocks.is_empty());
    }

    /// The schema CHECK repeats this, but as a string compare it only holds
    /// while check_instant keeps every row in the same spelling.
    #[test]
    fn block_must_end_after_it_starts() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        assert!(matches!(
            add_block(&mut conn, &t.id, T10, T9, None),
            Err(AppError::Invalid(_))
        ));
        assert!(
            matches!(
                add_block(&mut conn, &t.id, T9, T9, None),
                Err(AppError::Invalid(_))
            ),
            "an empty span is not a block"
        );
    }

    /// The instants that would store a correct time and then sort wrongly
    /// against their neighbours. This is the test that protects the SQL CHECK.
    #[test]
    fn block_instants_must_be_canonical_utc() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        for bad in [
            "2026-09-14T09:00:00-07:00", // right instant, wrong sort key
            "2026-09-14T09:00:00+00:00", // UTC, but not spelled Z
            "2026-09-14T09:00:00.000Z",  // fractional seconds break fixed width
            "2026-09-14T09:00Z",         // no seconds, ditto
            "2026-09-14",                // a date is not an instant
            "not a time",
        ] {
            assert!(
                matches!(
                    add_block(&mut conn, &t.id, bad, T12, None),
                    Err(AppError::Invalid(_))
                ),
                "accepted {bad:?}"
            );
        }
    }

    #[test]
    fn blocks_on_one_task_may_not_overlap() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        add_block(&mut conn, &t.id, T9, T11, None).unwrap();

        assert!(matches!(
            add_block(&mut conn, &t.id, T10, T12, None),
            Err(AppError::Invalid(_))
        ));
        assert_eq!(get_task(&conn, &t.id).unwrap().blocks.len(), 1);

        // Half-open: starting exactly where the other ended is not an overlap.
        let got = add_block(&mut conn, &t.id, T11, T12, None).unwrap();
        assert_eq!(got.blocks.len(), 2);
    }

    /// Partial overlap is the easy case; containment in either direction is
    /// what a naive `start BETWEEN ...` predicate would miss.
    #[test]
    fn overlap_catches_containment_both_ways() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        add_block(&mut conn, &t.id, T10, T11, None).unwrap();

        // New block swallows the existing one.
        assert!(matches!(
            add_block(&mut conn, &t.id, T9, T12, None),
            Err(AppError::Invalid(_))
        ));
        // New block sits entirely inside the existing one.
        assert!(matches!(
            add_block(
                &mut conn,
                &t.id,
                "2026-09-14T10:15:00Z",
                "2026-09-14T10:45:00Z",
                None
            ),
            Err(AppError::Invalid(_))
        ));
        // Exactly the same span.
        assert!(matches!(
            add_block(&mut conn, &t.id, T10, T11, None),
            Err(AppError::Invalid(_))
        ));
        assert_eq!(get_task(&conn, &t.id).unwrap().blocks.len(), 1);
    }

    /// Double-booking yourself across two tasks is real, and the calendar
    /// should draw it rather than refuse the write.
    #[test]
    fn blocks_on_different_tasks_may_overlap() {
        let mut conn = fresh();
        let a = create_task(&mut conn, "a", None, None).unwrap();
        let b = create_task(&mut conn, "b", None, None).unwrap();
        add_block(&mut conn, &a.id, T9, T11, None).unwrap();
        assert!(add_block(&mut conn, &b.id, T10, T12, None).is_ok());
    }

    #[test]
    fn add_block_reports_a_missing_task() {
        let mut conn = fresh();
        assert!(matches!(
            add_block(&mut conn, "nope", T9, T10, None),
            Err(AppError::NotFound(_))
        ));
    }

    /// The point of the narrow mutations: a move keeps the block's identity,
    /// so anything holding the id still resolves.
    #[test]
    fn update_block_moves_it_and_keeps_its_id() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        let id = add_block(&mut conn, &t.id, T9, T10, Some("UTC"))
            .unwrap()
            .blocks[0]
            .id
            .clone();

        let got = update_block(&mut conn, &id, T11, T12, None).unwrap();
        assert_eq!(got.blocks.len(), 1, "moved, not added");
        let b = &got.blocks[0];
        assert_eq!(b.id, id);
        assert_eq!((b.start_at.as_str(), b.end_at.as_str()), (T11, T12));
        assert_eq!(b.tz, None, "tz is replaced, so None clears it to floating");
    }

    /// Without the `except` arm of the overlap test, a block would collide
    /// with its own row and no block could ever be resized.
    #[test]
    fn update_block_does_not_collide_with_itself() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        let id = add_block(&mut conn, &t.id, T9, T11, None).unwrap().blocks[0]
            .id
            .clone();

        let got = update_block(&mut conn, &id, T9, T12, None).unwrap();
        assert_eq!(got.blocks[0].end_at, T12);
    }

    #[test]
    fn update_block_rejects_an_overlap_and_rolls_back() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        let first = add_block(&mut conn, &t.id, T9, T10, None).unwrap().blocks[0]
            .id
            .clone();
        add_block(&mut conn, &t.id, T11, T12, None).unwrap();

        assert!(matches!(
            update_block(&mut conn, &first, T10, T12, None),
            Err(AppError::Invalid(_))
        ));
        let blocks = get_task(&conn, &t.id).unwrap().blocks;
        assert_eq!(blocks[0].end_at, T10, "the rejected move rolled back");
    }

    #[test]
    fn block_mutations_report_a_missing_block() {
        let mut conn = fresh();
        assert!(matches!(
            update_block(&mut conn, "nope", T9, T10, None),
            Err(AppError::BlockNotFound(_))
        ));
        assert!(matches!(
            delete_block(&conn, "nope"),
            Err(AppError::BlockNotFound(_))
        ));
    }

    #[test]
    fn delete_block_unschedules_without_touching_the_task() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        let id = add_block(&mut conn, &t.id, T9, T10, None).unwrap().blocks[0]
            .id
            .clone();
        add_block(&mut conn, &t.id, T11, T12, None).unwrap();

        delete_block(&conn, &id).unwrap();
        let got = get_task(&conn, &t.id).unwrap();
        assert_eq!(got.blocks.len(), 1);
        assert_eq!(got.blocks[0].start_at, T11);
        assert_eq!(got.title, "write");
    }

    #[test]
    fn deleting_a_task_takes_its_blocks() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "write", None, None).unwrap();
        add_block(&mut conn, &t.id, T9, T10, None).unwrap();

        delete_task(&conn, &t.id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_blocks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "cascade — the fresh() fixture has foreign_keys ON");
    }

    #[test]
    fn due_must_be_zero_padded() {
        let mut conn = fresh();
        for _bad in ["2026-1-10", "2026-01-1"] {
            assert!(
                create_task(&mut conn, "t", Some(_bad), None).is_err(),
                "accepted {_bad:?}"
            );
        }
        assert!(create_task(&mut conn, "t", Some("2026-01-01"), None).is_ok());
    }
}
