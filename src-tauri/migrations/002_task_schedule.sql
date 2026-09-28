-- 002_task_schedule.sql — schema version 2.
--
-- Run by db::migrations::run inside an explicit transaction; do not add
-- BEGIN/COMMIT here. Frozen once shipped, like 001 — append 003_*.sql instead.
--
-- Calendar blocks: when the user actually sits down to work on a task. A task
-- may have any number of them, and they are independent of tasks.due, which
-- stays a deadline date with no time.

CREATE TABLE task_blocks (
    id       TEXT PRIMARY KEY,
    task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    -- UTC instants, written exactly as 'YYYY-MM-DDTHH:MM:SSZ'. The fixed width
    -- and the single zone are what make the CHECK below — and every ORDER BY
    -- and overlap test in tasks.rs — correct as plain string comparisons.
    -- tasks::check_instant enforces the spelling on the way in; nothing but
    -- that convention stands between this CHECK and a silent wrong answer.
    start_at TEXT NOT NULL,
    end_at   TEXT NOT NULL,
    -- IANA zone the user authored the block in ('America/Los_Angeles'), kept
    -- for ICS export. NULL = floating, render in whatever zone the app is in.
    -- Not an offset: offsets go stale across DST and the instant has one.
    tz       TEXT,
    CHECK (end_at > start_at)
);

-- "The blocks on this task", the join behind every task read.
CREATE INDEX idx_task_blocks_task ON task_blocks(task_id);

-- "The blocks in this week", for the calendar grid once it queries by range.
CREATE INDEX idx_task_blocks_start ON task_blocks(start_at);
