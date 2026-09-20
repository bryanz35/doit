CREATE TABLE task_blocks (
    id TEXT PRIMARY KEY,
    task_d TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    tz TEXT,
    CHECK (end_at > start_at)
)

CREATE INDEX idx_task_blocks_task ON task_blocks(task_id);
CREATE INDEX idx_task_blocks_start ON task_blocks(start_at);
