-- 004_settings.sql — schema version 4.
--
-- Run by db::migrations::run inside an explicit transaction; do not add
-- BEGIN/COMMIT here. Frozen once shipped — append 005_*.sql.
--
-- Free-form preferences (pomodoro lengths, daily goal, theme, …). Values are
-- strings the frontend parses; a missing key means "use the default", so
-- nothing is seeded here and defaults live in exactly one place, the UI.

CREATE TABLE settings (
    key   TEXT PRIMARY KEY CHECK (key <> ''),
    value TEXT NOT NULL
);
