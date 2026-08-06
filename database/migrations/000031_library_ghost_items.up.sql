ALTER TABLE library ADD COLUMN media_type TEXT CHECK (media_type IN ('video','audio'));

UPDATE library SET media_type = COALESCE(
    (SELECT d.download_type FROM downloads d WHERE d.id = library.download_id),
    CASE WHEN resolution IS NOT NULL THEN 'video' ELSE 'audio' END
);
