ALTER TABLE subscription_seen_entries ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE subscription_seen_entries ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE subscription_seen_entries ADD COLUMN duration_seconds REAL;
