ALTER TABLE library ADD COLUMN artist TEXT;
ALTER TABLE downloads ADD COLUMN override_artist TEXT;

UPDATE library SET artist = (SELECT name FROM artists WHERE artists.id = library.artist_id)
WHERE artist_id IS NOT NULL;

UPDATE downloads SET override_artist = (SELECT name FROM artists WHERE artists.id = downloads.override_artist_id)
WHERE override_artist_id IS NOT NULL;

ALTER TABLE library DROP COLUMN artist_id;
ALTER TABLE downloads DROP COLUMN override_artist_id;

DROP TABLE artists;
