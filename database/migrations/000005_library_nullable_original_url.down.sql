-- Restores NOT NULL, coalescing any NULL original_url (from imports) to ''
-- so the rebuild doesn't fail on existing data.
--
-- foreign_keys off for the same reason as the up migration (avoids the
-- implicit DROP-TABLE delete cascading into library_tags).
PRAGMA foreign_keys = OFF;

CREATE TABLE library_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id     INTEGER REFERENCES downloads(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    filename        TEXT NOT NULL,
    path            TEXT NOT NULL,
    collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    folder          TEXT NOT NULL DEFAULT '',
    original_url    TEXT NOT NULL,
    video_id        TEXT,
    uploader        TEXT,
    duration        INTEGER,
    resolution      TEXT,
    thumbnail       TEXT,
    description     TEXT,
    downloaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'completed',
    file_size_bytes INTEGER
);

INSERT INTO library_new (id, download_id, title, filename, path, collection_id, folder, original_url,
                          video_id, uploader, duration, resolution, thumbnail, description,
                          downloaded_at, status, file_size_bytes)
SELECT id, download_id, title, filename, path, collection_id, folder, COALESCE(original_url, ''),
       video_id, uploader, duration, resolution, thumbnail, description,
       downloaded_at, status, file_size_bytes
FROM library;

DROP TABLE library;
ALTER TABLE library_new RENAME TO library;

CREATE INDEX idx_library_collection_id ON library(collection_id);
CREATE INDEX idx_library_original_url ON library(original_url);
CREATE INDEX idx_library_video_id ON library(video_id);
CREATE INDEX idx_library_status ON library(status);
CREATE INDEX idx_library_downloaded_at ON library(downloaded_at);

PRAGMA foreign_keys = ON;
