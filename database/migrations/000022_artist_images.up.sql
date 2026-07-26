ALTER TABLE artists ADD COLUMN selected_image_path TEXT;

CREATE TABLE artist_images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_id     INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
