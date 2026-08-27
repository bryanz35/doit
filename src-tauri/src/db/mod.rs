use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub mod migrations;

pub struct Db(pub Mutex<Connection>);
// creates db files and opens connection, then moves handling to migrations.rs
pub fn open(dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(dir)?;
    let conn = Connection::open(dir.join("doit.sqlite3"))?;

    // what?
    conn.pragma_update(None, "foreign_keys", "ON")?;

    conn.pragma_update(None, "journal_mode", "WAL")?;

    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrations::run(&conn)?;
    Ok(conn)
}
