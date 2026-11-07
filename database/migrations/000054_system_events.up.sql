-- Persistent system log: a small, curated record of server events (startup,
-- migrations, recovery, backups, security...) that survives container updates.
-- No foreign keys: rows stand alone and are pruned by count (Settings -> History).
CREATE TABLE IF NOT EXISTS system_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    level      TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    category   TEXT NOT NULL,
    message    TEXT NOT NULL,
    details    TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at);
CREATE INDEX IF NOT EXISTS idx_system_events_level_created_at ON system_events(level, created_at);
CREATE INDEX IF NOT EXISTS idx_system_events_category_created_at ON system_events(category, created_at);
