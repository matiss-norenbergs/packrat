-- Adds "image" as a third download_type/media_type alongside video/audio, for
-- the new direct-image-URL download path. SQLite has no ALTER TABLE ... DROP
-- CONSTRAINT, so widening a CHECK requires a full table rebuild.
--
-- foreign_keys off for both rebuilds: SQLite's DROP TABLE performs an implicit
-- "DELETE FROM" first when foreign_keys is on, which would fire every
-- ON DELETE CASCADE FK pointing at the dropped table and silently drop rows
-- that reference it. For library specifically that now means library_tags,
-- compare_list, thumbnail_enhancement_originals, frame_match_queue, and
-- thumbnail_gallery — more cascade dependents than existed at migration 000005,
-- the last time this table was rebuilt. Requires db.Migrate to run with
-- NoTxWrap (see db.go).
PRAGMA foreign_keys = OFF;

CREATE TABLE downloads_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    video_id          TEXT,
    collection_id     INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    folder            TEXT NOT NULL DEFAULT '',
    filename          TEXT NOT NULL DEFAULT '',
    download_type     TEXT NOT NULL CHECK (download_type IN ('video','audio','image')),
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
    completed_at      TEXT,
    override_title            TEXT,
    override_year             INTEGER,
    override_season_number    INTEGER,
    override_sequence_number  INTEGER,
    filename_prefix           TEXT,
    override_artist_id        INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    override_tags             TEXT,
    generate_nfo               INTEGER NOT NULL DEFAULT 0,
    filename_template          TEXT,
    target_library_item_id     INTEGER,
    overwrite_fields           TEXT
);

INSERT INTO downloads_new (id, url, video_id, collection_id, folder, filename, download_type,
                            quality, audio_format, status, title, uploader, duration, resolution,
                            thumbnail, error_message, ytdlp_command, exit_code, stdout_tail,
                            stderr_tail, retry_count, created_at, updated_at, completed_at,
                            override_title, override_year, override_season_number,
                            override_sequence_number, filename_prefix, override_artist_id,
                            override_tags, generate_nfo, filename_template,
                            target_library_item_id, overwrite_fields)
SELECT id, url, video_id, collection_id, folder, filename, download_type,
       quality, audio_format, status, title, uploader, duration, resolution,
       thumbnail, error_message, ytdlp_command, exit_code, stdout_tail,
       stderr_tail, retry_count, created_at, updated_at, completed_at,
       override_title, override_year, override_season_number,
       override_sequence_number, filename_prefix, override_artist_id,
       override_tags, generate_nfo, filename_template,
       target_library_item_id, overwrite_fields
FROM downloads;

DROP TABLE downloads;
ALTER TABLE downloads_new RENAME TO downloads;

CREATE INDEX idx_downloads_status ON downloads(status);
CREATE INDEX idx_downloads_created_at ON downloads(created_at);
CREATE INDEX idx_downloads_url ON downloads(url);

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
    file_size_bytes INTEGER,
    release_year                INTEGER,
    sequence_number              INTEGER,
    generate_nfo                 INTEGER NOT NULL DEFAULT 0,
    season_number                INTEGER,
    artist_id                    INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    playback_position_seconds    INTEGER,
    last_watched_at              TEXT,
    thumbnail_small_path         TEXT,
    thumbnail_medium_path        TEXT,
    media_type                   TEXT CHECK (media_type IN ('video','audio','image')),
    thumbnail_width              INTEGER,
    thumbnail_height             INTEGER
);

INSERT INTO library_new (id, download_id, title, filename, path, collection_id, folder,
                          original_url, video_id, uploader, duration, resolution, thumbnail,
                          description, downloaded_at, status, file_size_bytes, release_year,
                          sequence_number, generate_nfo, season_number, artist_id,
                          playback_position_seconds, last_watched_at, thumbnail_small_path,
                          thumbnail_medium_path, media_type, thumbnail_width, thumbnail_height)
SELECT id, download_id, title, filename, path, collection_id, folder,
       original_url, video_id, uploader, duration, resolution, thumbnail,
       description, downloaded_at, status, file_size_bytes, release_year,
       sequence_number, generate_nfo, season_number, artist_id,
       playback_position_seconds, last_watched_at, thumbnail_small_path,
       thumbnail_medium_path, media_type, thumbnail_width, thumbnail_height
FROM library;

DROP TABLE library;
ALTER TABLE library_new RENAME TO library;

CREATE INDEX idx_library_collection_id ON library(collection_id);
CREATE INDEX idx_library_original_url ON library(original_url);
CREATE INDEX idx_library_video_id ON library(video_id);
CREATE INDEX idx_library_status ON library(status);
CREATE INDEX idx_library_downloaded_at ON library(downloaded_at);

PRAGMA foreign_keys = ON;
