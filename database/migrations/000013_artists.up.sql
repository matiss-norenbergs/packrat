CREATE TABLE artists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE library ADD COLUMN artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL;
ALTER TABLE downloads ADD COLUMN override_artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL;

-- Backfill both tables' historical free-text values into deduplicated artists rows.
INSERT INTO artists (name)
SELECT DISTINCT artist FROM library WHERE artist IS NOT NULL AND TRIM(artist) != ''
UNION
SELECT DISTINCT override_artist FROM downloads WHERE override_artist IS NOT NULL AND TRIM(override_artist) != '';

UPDATE library SET artist_id = (SELECT id FROM artists WHERE artists.name = library.artist)
WHERE artist IS NOT NULL AND TRIM(artist) != '';

UPDATE downloads SET override_artist_id = (SELECT id FROM artists WHERE artists.name = downloads.override_artist)
WHERE override_artist IS NOT NULL AND TRIM(override_artist) != '';

ALTER TABLE library DROP COLUMN artist;
ALTER TABLE downloads DROP COLUMN override_artist;
