PRAGMA foreign_keys = ON;

CREATE TABLE collections (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT NOT NULL UNIQUE,
    root_path              TEXT NOT NULL,
    default_quality        TEXT NOT NULL DEFAULT 'best',
    default_download_type  TEXT NOT NULL DEFAULT 'video',
    filename_template      TEXT NOT NULL DEFAULT '{title}',
    subtitle_defaults      TEXT,
    metadata_defaults      TEXT,
    sponsorblock_defaults  TEXT,
    jellyfin_library       TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE downloads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    video_id          TEXT,
    collection_id     INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    folder            TEXT NOT NULL DEFAULT '',
    filename          TEXT NOT NULL DEFAULT '',
    download_type     TEXT NOT NULL CHECK (download_type IN ('video','audio')),
    quality           TEXT NOT NULL DEFAULT 'best',
    audio_format      TEXT,
    status            TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','fetching_metadata','downloading',
                          'processing','completed','failed','cancelled','interrupted')),
    title             TEXT,
    uploader          TEXT,
    duration          INTEGER,
    resolution        TEXT,
    thumbnail         TEXT,
    error_message     TEXT,
    ytdlp_command     TEXT,
    exit_code         INTEGER,
    stdout_tail       TEXT,
    stderr_tail       TEXT,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT
);
CREATE INDEX idx_downloads_status ON downloads(status);
CREATE INDEX idx_downloads_created_at ON downloads(created_at);
CREATE INDEX idx_downloads_url ON downloads(url);

CREATE TABLE library (
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
CREATE INDEX idx_library_collection_id ON library(collection_id);
CREATE INDEX idx_library_original_url ON library(original_url);
CREATE INDEX idx_library_video_id ON library(video_id);
CREATE INDEX idx_library_status ON library(status);
CREATE INDEX idx_library_downloaded_at ON library(downloaded_at);

CREATE TABLE tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE library_tags (
    library_id INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (library_id, tag_id)
);

CREATE TABLE history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id   INTEGER REFERENCES downloads(id) ON DELETE SET NULL,
    url           TEXT NOT NULL,
    status        TEXT NOT NULL,
    error_message TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_created_at ON history(created_at);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES
    ('download_directory', './data/media'),
    ('max_concurrent_downloads', '2');
