//! Calendar export: the `Task` rows `list_tasks` returns, as an iCalendar
//! (RFC 5545) file. Pure, so it is tested without an app handle;
//! `command::export_ics` writes the result to disk.

use crate::model::{Task, TaskStatus};
use chrono::{DateTime, NaiveDate, Utc};

/// The whole calendar, CRLF line endings. Every block becomes a timed event;
/// with `include_due`, every unfinished task with a due date also becomes an
/// all-day event on that date.
pub fn calendar(tasks: &[Task], include_due: bool, now: DateTime<Utc>) -> String {
    let stamp = now.format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines: Vec<String> = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DOIT//DOIT//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:DOIT",
    ]
    .map(String::from)
    .into();

    for task in tasks {
        for block in &task.blocks {
            // UTC rather than TZID=block.tz: exact for a one-off event and needs no
            // VTIMEZONE. The zone only starts to matter once blocks can recur.
            lines.extend(event(
                &format!("{}@doit", block.id),
                &stamp,
                format!("DTSTART:{}", compact(&block.start_at)),
                format!("DTEND:{}", compact(&block.end_at)),
                &task.title,
                task.notes.as_deref(),
            ));
        }
        if !include_due || task.status == TaskStatus::Done {
            continue;
        }
        // `check_due` guarantees YYYY-MM-DD on the way in.
        let due = task.due.as_deref();
        if let Some(day) = due.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) {
            // An all-day DTEND is exclusive: the event covers `day` only.
            let next = day.succ_opt().unwrap_or(day);
            lines.extend(event(
                &format!("{}-due@doit", task.id),
                &stamp,
                format!("DTSTART;VALUE=DATE:{}", day.format("%Y%m%d")),
                format!("DTEND;VALUE=DATE:{}", next.format("%Y%m%d")),
                &format!("Due: {}", task.title),
                task.notes.as_deref(),
            ));
        }
    }

    lines.push("END:VCALENDAR".into());
    lines.iter().map(|line| fold(line) + "\r\n").collect()
}

fn event(
    uid: &str,
    stamp: &str,
    start: String,
    end: String,
    summary: &str,
    notes: Option<&str>,
) -> Vec<String> {
    let mut lines = vec![
        "BEGIN:VEVENT".to_string(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{stamp}"),
        start,
        end,
        format!("SUMMARY:{}", escape(summary)),
    ];
    if let Some(notes) = notes {
        lines.push(format!("DESCRIPTION:{}", escape(notes)));
    }
    lines.push("END:VEVENT".into());
    lines
}

/// `2026-11-03T09:00:00Z` → `20261103T090000Z`. Only valid for the one spelling
/// `tasks::check_instant` lets into `task_blocks`.
fn compact(instant: &str) -> String {
    instant.replace(['-', ':'], "")
}

/// RFC 5545 TEXT escaping.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// A content line is at most 75 octets; the rest continues on the next line
/// after one space. Splits fall between chars, never inside a UTF-8 sequence.
fn fold(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + line.len() / 25);
    let mut width = 0;
    for c in line.chars() {
        if width + c.len_utf8() > 75 {
            out.push_str("\r\n ");
            width = 1; // the leading space counts
        }
        out.push(c);
        width += c.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::model::TaskPatch;
    use crate::tasks::{add_block, create_task, list_tasks, toggle_task, update_task};
    use rusqlite::Connection;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn now() -> DateTime<Utc> {
        "2026-11-02T12:00:00Z".parse().unwrap()
    }

    /// Content lines with the folding undone and the CRLFs stripped.
    fn unfolded(ics: &str) -> Vec<String> {
        ics.replace("\r\n ", "")
            .split("\r\n")
            .filter(|line| !line.is_empty())
            .map(String::from)
            .collect()
    }

    fn has(lines: &[String], want: &str) -> bool {
        lines.iter().any(|line| line == want)
    }

    #[test]
    fn a_block_becomes_a_timed_utc_event() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "Write report", None, None).unwrap();
        let t = add_block(
            &mut conn,
            &t.id,
            "2026-11-03T09:00:00Z",
            "2026-11-03T10:30:00Z",
            Some("Europe/Berlin"),
        )
        .unwrap();

        let lines = unfolded(&calendar(&list_tasks(&conn).unwrap(), false, now()));
        assert_eq!(lines.first().unwrap(), "BEGIN:VCALENDAR");
        assert_eq!(lines.last().unwrap(), "END:VCALENDAR");
        assert!(has(&lines, &format!("UID:{}@doit", t.blocks[0].id)));
        assert!(has(&lines, "DTSTAMP:20261102T120000Z"));
        assert!(has(&lines, "DTSTART:20261103T090000Z"));
        assert!(has(&lines, "DTEND:20261103T103000Z"));
        assert!(has(&lines, "SUMMARY:Write report"));
    }

    #[test]
    fn due_dates_are_all_day_events_only_when_asked() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "Ship", Some("2026-10-31"), None).unwrap();
        let tasks = list_tasks(&conn).unwrap();

        let scheduled = unfolded(&calendar(&tasks, false, now()));
        assert!(!has(&scheduled, "BEGIN:VEVENT"));

        let all = unfolded(&calendar(&tasks, true, now()));
        assert!(has(&all, &format!("UID:{}-due@doit", t.id)));
        assert!(has(&all, "DTSTART;VALUE=DATE:20261031"));
        assert!(has(&all, "DTEND;VALUE=DATE:20261101")); // exclusive, across the month
        assert!(has(&all, "SUMMARY:Due: Ship"));
    }

    #[test]
    fn a_done_task_keeps_its_blocks_but_not_its_due_date() {
        let mut conn = fresh();
        let t = create_task(&mut conn, "Old", Some("2026-11-01"), None).unwrap();
        add_block(&mut conn, &t.id, "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z", None).unwrap();
        toggle_task(&conn, &t.id).unwrap();

        let lines = unfolded(&calendar(&list_tasks(&conn).unwrap(), true, now()));
        assert_eq!(lines.iter().filter(|l| *l == "BEGIN:VEVENT").count(), 1);
        assert!(!lines.iter().any(|l| l.contains("VALUE=DATE")));
    }

    #[test]
    fn text_is_escaped() {
        let mut conn = fresh();
        let t = create_task(&mut conn, r"a,b;c\d", None, None).unwrap();
        let patch = TaskPatch { notes: Some("one\r\ntwo".into()), ..Default::default() };
        update_task(&conn, &t.id, &patch).unwrap();
        add_block(&mut conn, &t.id, "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", None).unwrap();

        let lines = unfolded(&calendar(&list_tasks(&conn).unwrap(), false, now()));
        assert!(has(&lines, r"SUMMARY:a\,b\;c\\d"));
        assert!(has(&lines, r"DESCRIPTION:one\ntwo"));
    }

    #[test]
    fn long_lines_fold_at_75_octets_between_chars() {
        let mut conn = fresh();
        let title = "é".repeat(60) + "ok";
        let t = create_task(&mut conn, &title, None, None).unwrap();
        add_block(&mut conn, &t.id, "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", None).unwrap();

        let ics = calendar(&list_tasks(&conn).unwrap(), false, now());
        assert!(ics.ends_with("\r\n"));
        assert!(!ics.replace("\r\n", "").contains('\n'), "bare LF in output");
        let physical: Vec<&str> = ics.split("\r\n").collect();
        assert!(physical.iter().all(|line| line.len() <= 75));
        assert!(physical.iter().any(|line| line.starts_with(' ')), "nothing was folded");
        assert!(has(&unfolded(&ics), &format!("SUMMARY:{title}")));
    }
}
