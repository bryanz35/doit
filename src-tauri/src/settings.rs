//! Key/value preferences over a plain `rusqlite::Connection`.
//!
//! Values are opaque strings; the frontend owns both their parsing and their
//! defaults. A missing key means "default", which is why clearing a setting is
//! a delete rather than a write of some sentinel.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// Every stored setting. Keys the user never changed are simply absent.
pub fn get_settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut tmp = conn.prepare("SELECT key, value FROM settings")?;
    let rows = tmp.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Write one setting, or with `None` delete it back to its default.
pub fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Invalid("Setting key must not be empty".into()));
    }
    match value {
        Some(value) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn set_overwrites_and_none_deletes() {
        let conn = fresh();
        assert!(get_settings(&conn).unwrap().is_empty());

        set_setting(&conn, "focus.workMinutes", Some("25")).unwrap();
        set_setting(&conn, "focus.workMinutes", Some("50")).unwrap();
        set_setting(&conn, "theme", Some("dark")).unwrap();
        let got = get_settings(&conn).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got["focus.workMinutes"], "50");

        set_setting(&conn, "theme", None).unwrap();
        assert!(!get_settings(&conn).unwrap().contains_key("theme"));
        // Deleting a key that was never set is fine.
        set_setting(&conn, "never-set", None).unwrap();
    }

    #[test]
    fn keys_are_trimmed_and_must_not_be_empty() {
        let conn = fresh();
        set_setting(&conn, "  theme  ", Some("dark")).unwrap();
        assert!(get_settings(&conn).unwrap().contains_key("theme"));
        assert!(matches!(
            set_setting(&conn, "   ", Some("x")),
            Err(AppError::Invalid(_))
        ));
    }
}
