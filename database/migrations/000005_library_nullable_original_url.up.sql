-- Every existing path to creating a library row goes through a completed
-- download, which always has a URL. Imported files (added directly under
-- MEDIA_ROOT, outside the app) are the first case where the source URL is
-- legitimately unknown, so original_url becomes nullable.
--
-- foreign_keys off for the rebuild: SQLite's DROP TABLE performs an implicit
-- "DELETE FROM" first when foreign_keys is on, which would fire
-- library_tags.library_id's ON DELETE CASCADE and silently drop any tag
-- associations. Requires db.Migrate to run with NoTxWrap (see db.go).
PRAGMA foreign_keys = OFF;

CREATE TABLE library_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id     INTEGER REFERENCES downloads(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    filename        TEXT NOT NULL,
    path            TEXT NOT NULL,
    collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    folder          TEXT NOT NULL DEFAULT '',
    original_url    TEXT,
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
SELECT id, download_id, title, filename, path, collection_id, folder, original_url,
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
