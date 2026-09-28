use crate::error::Result;
use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/001_tasks.sql"),
    include_str!("../../migrations/002_task_schedule.sql"),
];

pub fn run(conn: &Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        conn.execute_batch("BEGIN")?;
        match conn.execute_batch(sql) {
            Ok(()) => {
                conn.pragma_update(None, "user_version", i as u32 + 1)?;
                conn.execute_batch("COMMIT")?;
            }
            Err(e) => {
                conn.execute_batch("ROLLBACK")?;
                return Err(e.into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        run(&conn).unwrap();
        conn
    }
    /// The upgrade path a shipped install takes: a v1 database with rows in it
    /// must reach v2 without losing them. `fresh()` only ever proves the
    /// from-scratch path, where every migration runs against an empty file.
    #[test]
    fn an_existing_v1_database_upgrades_in_place() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();

        // Stop at version 1, the way a user on the previous release would be.
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1u32).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title) VALUES ('t1', 'survives the upgrade')",
            [],
        )
        .unwrap();

        run(&conn).unwrap();

        let v: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "survives the upgrade");
        // The new table exists and is usable against the pre-existing row.
        conn.execute(
            "INSERT INTO task_blocks (id, task_id, start_at, end_at)
             VALUES ('b1', 't1', '2026-09-14T09:00:00Z', '2026-09-14T10:00:00Z')",
            [],
        )
        .unwrap();
    }

    // checks if migrations are the same after applying twice
    #[test]
    fn migrations_are_idempotent() {
        let conn = fresh();
        run(&conn).unwrap(); // what does this do?
        let v: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
    }
}
