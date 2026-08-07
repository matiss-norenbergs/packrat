ALTER TABLE subscription_seen_entries ADD COLUMN seen_at TEXT;
UPDATE subscription_seen_entries SET seen_at = first_seen_at WHERE seen_at IS NULL;
