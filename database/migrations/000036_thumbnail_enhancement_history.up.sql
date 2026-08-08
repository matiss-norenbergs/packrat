CREATE TABLE thumbnail_enhancement_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_item_id INTEGER REFERENCES library(id) ON DELETE SET NULL,
    item_title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    original_width INTEGER,
    original_height INTEGER,
    enhanced_width INTEGER,
    enhanced_height INTEGER,
    original_size_bytes INTEGER,
    enhanced_size_bytes INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
