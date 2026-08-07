CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('video','audio')),
    collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    tags TEXT NOT NULL DEFAULT '',
    auto_download INTEGER NOT NULL DEFAULT 0,
    generate_nfo INTEGER NOT NULL DEFAULT 0,
    check_interval_hours INTEGER NOT NULL DEFAULT 6,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscription_seen_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    library_item_id INTEGER REFERENCES library(id) ON DELETE SET NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (subscription_id, source_id)
);
