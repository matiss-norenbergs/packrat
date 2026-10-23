DROP INDEX idx_sessions_public_id;
ALTER TABLE sessions DROP COLUMN user_agent;
ALTER TABLE sessions DROP COLUMN ip;
ALTER TABLE sessions DROP COLUMN client;
ALTER TABLE sessions DROP COLUMN last_seen_at;
ALTER TABLE sessions DROP COLUMN public_id;
