ALTER TABLE tasks ADD COLUMN start_at TEXT;
ALTER TABLE tasks ADD COLUMN end_at TEXT;
CREATE INDEX idx_tasks_start_at ON tasks(start_at);
