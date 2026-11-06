-- SQLite does not index the child side of a foreign key, so every parent delete
-- (downloads, library, tags, artists, collections) scanned each child table once
-- per deleted row. One index per FK child column fixes that.
CREATE INDEX IF NOT EXISTS idx_library_download_id ON library(download_id);
CREATE INDEX IF NOT EXISTS idx_library_artist_id ON library(artist_id);
CREATE INDEX IF NOT EXISTS idx_library_tags_tag_id ON library_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_history_download_id ON history(download_id);
CREATE INDEX IF NOT EXISTS idx_downloads_override_artist_id ON downloads(override_artist_id);
CREATE INDEX IF NOT EXISTS idx_downloads_collection_id ON downloads(collection_id);
CREATE INDEX IF NOT EXISTS idx_collections_artist_id ON collections(artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_images_artist_id ON artist_images(artist_id);
CREATE INDEX IF NOT EXISTS idx_frame_match_queue_library_item_id ON frame_match_queue(library_item_id);
CREATE INDEX IF NOT EXISTS idx_subscription_seen_entries_library_item_id ON subscription_seen_entries(library_item_id);
CREATE INDEX IF NOT EXISTS idx_thumbnail_enhancement_history_library_item_id ON thumbnail_enhancement_history(library_item_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_collection_id ON subscriptions(collection_id);
