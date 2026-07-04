-- Restores global name uniqueness. If duplicate names now exist across
-- different parents (expected, since that's the whole point of the up
-- migration), this will fail with a UNIQUE constraint error — resolve any
-- duplicates manually before downgrading.
--
-- foreign_keys off for the same reason as the up migration: DROP TABLE's
-- implicit delete would otherwise hit parent_id's own ON DELETE RESTRICT
-- and SET NULL every downloads/library row's collection_id.
PRAGMA foreign_keys = OFF;

CREATE TABLE collections_new (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT NOT NULL UNIQUE,
    parent_id              INTEGER REFERENCES collections(id) ON DELETE RESTRICT,
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

INSERT INTO collections_new (id, name, parent_id, root_path, default_quality, default_download_type,
                              filename_template, subtitle_defaults, metadata_defaults, sponsorblock_defaults,
                              jellyfin_library, created_at, updated_at)
SELECT id, name, parent_id, root_path, default_quality, default_download_type,
       filename_template, subtitle_defaults, metadata_defaults, sponsorblock_defaults,
       jellyfin_library, created_at, updated_at
FROM collections;

DROP TABLE collections;
ALTER TABLE collections_new RENAME TO collections;

CREATE INDEX idx_collections_parent_id ON collections(parent_id);

PRAGMA foreign_keys = ON;
