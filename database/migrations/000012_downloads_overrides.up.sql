ALTER TABLE downloads ADD COLUMN override_title TEXT;
ALTER TABLE downloads ADD COLUMN override_artist TEXT;
ALTER TABLE downloads ADD COLUMN override_year INTEGER;
ALTER TABLE downloads ADD COLUMN override_season_number INTEGER;
ALTER TABLE downloads ADD COLUMN override_sequence_number INTEGER;
ALTER TABLE downloads ADD COLUMN filename_prefix TEXT;
