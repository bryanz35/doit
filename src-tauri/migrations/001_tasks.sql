-- 001_tasks.sql — schema version 1.
--
-- Run by db::migrations::run inside an explicit transaction; do not add
-- BEGIN/COMMIT here. Once this has shipped it is frozen: change the schema by
-- appending 002_*.sql, never by editing this file.
--
-- Mirrors the Task interface in src/types.ts. Column names are snake_case;
-- serde renames them to camelCase on the way to the frontend.

CREATE TABLE tasks (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    notes            TEXT,
    status           TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo','in-progress','done','idea','blocked')),
    due              TEXT,           -- ISO date, YYYY-MM-DD. NULL = unscheduled.
    estimate_minutes INTEGER,
    pomodoros        INTEGER,
    list             TEXT,
    repo             TEXT,
    completed_at     TEXT,           -- RFC3339 timestamp, set when status -> 'done'
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    sort_order       REAL NOT NULL DEFAULT 0
);

-- Task.tags: string[]. One row per tag.
CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
);

-- Task.dependsOn: string[]. Edge from task_id -> depends_on_id, drawn on the
-- graph page. Self-edges are rejected here; longer cycles are Rust's job.
CREATE TABLE task_deps (
    task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_id),
    CHECK (task_id <> depends_on_id)
);

-- The task list filters by status and buckets by due date.
CREATE INDEX idx_tasks_status_due ON tasks(status, due);

-- "What is blocked by this task" — the reverse of the task_deps primary key.
CREATE INDEX idx_task_deps_depends_on ON task_deps(depends_on_id);
