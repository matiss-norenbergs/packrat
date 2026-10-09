-- timestamp_seconds: where in the video the saved frame was taken from, when
-- known (picker / frame-match saves). NULL for older rows and for saves of an
-- existing thumbnail or enhancement original, which carry no source time.
ALTER TABLE thumbnail_gallery ADD COLUMN timestamp_seconds REAL;
ALTER TABLE thumbnail_gallery ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
