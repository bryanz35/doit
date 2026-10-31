-- 003_focus.sql — schema version 3.
--
-- Run by db::migrations::run inside an explicit transaction; do not add
-- BEGIN/COMMIT here. Frozen once shipped, like 001 and 002 — append 004_*.sql.
--
-- Pomodoro sessions. A session stores the instants it was started, paused and
-- ended at, never a countdown: remaining time is derived from them on every
-- read (focus::derive), so it survives page switches, restarts and suspend.
--
-- Instants use the task_blocks spelling, 'YYYY-MM-DDTHH:MM:SSZ', for the same
-- reason — the CHECKs and ORDER BYs below are string comparisons.

CREATE TABLE focus_sessions (
    id              TEXT PRIMARY KEY,
    -- SET NULL, not CASCADE: deleting a task must not erase the time spent on
    -- it. Breaks, and work with no task picked, have no task at all.
    task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    -- The calendar block covering the moment the session started, if any.
    block_id        TEXT REFERENCES task_blocks(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('work','short-break','long-break')),
    started_at      TEXT NOT NULL,
    planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
    -- Set while paused. Resuming folds the gap into paused_seconds and clears it.
    paused_at       TEXT,
    paused_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
    -- NULL = the session is open. At most one row may be open (index below).
    ended_at        TEXT,
    outcome         TEXT CHECK (outcome IN ('completed','skipped','abandoned')),

    CHECK ((ended_at IS NULL) = (outcome IS NULL)),
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    -- Finishing a paused session folds the pause first, so a closed row is
    -- never also paused.
    CHECK (ended_at IS NULL OR paused_at IS NULL)
);

-- One open session at a time. Every open row indexes the same value (1), so a
-- second one is a duplicate key; closed rows fall outside the partial index.
CREATE UNIQUE INDEX idx_focus_sessions_one_open
    ON focus_sessions ((ended_at IS NULL)) WHERE ended_at IS NULL;

-- "Today's sessions", queried by a local-day range sent as UTC instants.
CREATE INDEX idx_focus_sessions_started ON focus_sessions(started_at);

-- Pomodoros done per task, counted on every task read.
CREATE INDEX idx_focus_sessions_task ON focus_sessions(task_id);

-- Distractions noted during a session.
CREATE TABLE focus_interruptions (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
    at         TEXT NOT NULL,
    note       TEXT NOT NULL CHECK (note <> '')
);

CREATE INDEX idx_focus_interruptions_session ON focus_interruptions(session_id);
