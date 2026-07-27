CREATE TABLE compare_list (
    library_id INTEGER PRIMARY KEY REFERENCES library(id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
