-- Session tokens are now stored as hex(SHA-256(token)), not as the token itself, so a leaked
-- database or backup holds nothing a client can present. SQLite has no SHA-256, so the existing
-- plaintext rows cannot be converted: every session is dropped and everyone (web, desktop app,
-- API clients) signs in once after the upgrade. The automatic pre-migration database copy covers
-- this migration.
DELETE FROM sessions;
