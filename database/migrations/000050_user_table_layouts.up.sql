-- Per-account saved table layouts (hidden columns, sort, column widths), one JSON document per
-- (user, table). Kept apart from `user_preferences` because the value is a structured document
-- that the client fetches in one go, and apart from the global `settings` table and out of backups
-- for the same reason as preferences: it follows the user, not the server. The API validates and
-- canonicalizes `layout` (see models.ParseTableLayout) and caps layouts per account. Same ON DELETE
-- CASCADE as `user_preferences`: foreign keys are enabled on every connection (see db.Open).
CREATE TABLE user_table_layouts (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_id   TEXT NOT NULL,
    layout     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, table_id)
);
