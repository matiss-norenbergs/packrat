CREATE TABLE frame_match_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_item_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
    item_title TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('url', 'current')),
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'error')) DEFAULT 'queued',
    timestamp_seconds REAL,
    score REAL,
    found_frame_path TEXT,
    reference_image_path TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
