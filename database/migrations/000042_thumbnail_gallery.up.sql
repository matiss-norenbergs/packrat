CREATE TABLE thumbnail_gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_item_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_thumbnail_gallery_library_item_id ON thumbnail_gallery(library_item_id);
