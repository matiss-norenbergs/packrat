CREATE TABLE thumbnail_enhancement_originals (
    library_item_id INTEGER PRIMARY KEY REFERENCES library(id) ON DELETE CASCADE,
    original_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
