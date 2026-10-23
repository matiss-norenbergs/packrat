-- Opt-in TOTP two-factor auth. Secrets are stored encrypted (AES-GCM, key kept outside the DB).
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN totp_pending_enc TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
-- Highest accepted 30 s time step; a code from this step or earlier can't be used again.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
-- Failed attempts are reported "since" this moment (NULL = since the account was created).
ALTER TABLE users ADD COLUMN security_ack_at TEXT;

-- One-time recovery codes, stored as keyed hashes only.
CREATE TABLE recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recovery_codes_user_id ON recovery_codes(user_id);

-- Failed login attempts (time, address, step), pruned after ~30 days.
CREATE TABLE login_failures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_failures_created_at ON login_failures(created_at);
