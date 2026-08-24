use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub mod migrations;

pub struct Db(pub Mutex<Connection>);

pub fn open(dir: &Path) -> crate::Result<Connection> {
    std::fs::create_dir_all(dir)?;
    let conn = Connection::open(dir.join("doit.sqlite3"))?;

    Ok(conn)
}
