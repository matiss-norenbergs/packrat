-- Per-account UI preferences (theme, accent color), kept apart from the global `settings` table so
-- they follow the user rather than the server and stay out of backups. Same ON DELETE CASCADE as
-- `sessions`: foreign keys are enabled on every connection (see db.Open), so deleting a user
-- removes their preferences. Rows are optional; an unset key means the in-code default.
CREATE TABLE user_preferences (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key)
);
