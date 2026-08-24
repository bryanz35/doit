use crate::error::Result;
use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[include_str!("../../migrations/001_tasks.sql")];

pub fn run(conn: &Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        conn.execute_batch("BEGIN")?;
        match conn.execute_batch(sql) {
            Ok(()) => {
                conn.pragma_update(None, "User_version", i as u32 + 1)?;
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
