CREATE TABLE backup_history (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    trigger_type         TEXT NOT NULL,
    status               TEXT NOT NULL,
    file_name            TEXT,
    file_size_bytes      INTEGER,
    library_items_count  INTEGER,
    collections_count    INTEGER,
    tags_count           INTEGER,
    artists_count        INTEGER,
    error_message        TEXT
);
