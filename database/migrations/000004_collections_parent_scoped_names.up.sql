-- Collection names were globally unique; real folder trees legitimately
-- reuse names at different branches (e.g. "Season 1" under two different
-- shows), so uniqueness moves to being scoped per-parent, enforced at the
-- application layer (CollectionsRepo.nameInUse) rather than via a DB
-- constraint, since SQLite's NULL != NULL semantics mean a composite
-- UNIQUE(parent_id, name) index would not actually stop duplicate
-- root-level (parent_id IS NULL) names anyway.
--
-- foreign_keys must be off for this rebuild: SQLite's DROP TABLE performs an
-- implicit "DELETE FROM" first when foreign_keys is on, which would fire
-- collections.parent_id's own ON DELETE RESTRICT (blocking the drop outright
-- whenever any parent/child collection pair coexists) and would also SET
-- NULL every downloads/library row's collection_id in the process. Requires
-- db.Migrate to run with NoTxWrap, since PRAGMA foreign_keys is a no-op
-- inside a transaction.
PRAGMA foreign_keys = OFF;

CREATE TABLE collections_new (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT NOT NULL,
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
CREATE INDEX idx_collections_name ON collections(name);

PRAGMA foreign_keys = ON;
