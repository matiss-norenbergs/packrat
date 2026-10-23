-- Active-sessions list: per-session metadata and a non-secret id for the API (the token itself is
-- the credential and never leaves the server after login). Every column is nullable or defaulted,
-- so sessions created before this migration keep working and show up as "unknown device".
ALTER TABLE sessions ADD COLUMN public_id TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN client TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

UPDATE sessions SET public_id = lower(hex(randomblob(8))) WHERE public_id IS NULL;
CREATE UNIQUE INDEX idx_sessions_public_id ON sessions(public_id);
