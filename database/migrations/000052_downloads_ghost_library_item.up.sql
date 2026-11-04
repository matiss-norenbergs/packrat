-- The library item (a "ghost" while the download runs) a download is filling in. Set by the queue
-- worker when a run creates or reuses a ghost, and read back by Retry so a retried download reuses
-- the same row instead of creating a duplicate. The FK nulls out if the item is deleted.
ALTER TABLE downloads ADD COLUMN ghost_library_item_id INTEGER REFERENCES library(id) ON DELETE SET NULL;

CREATE INDEX idx_downloads_ghost_library_item_id ON downloads(ghost_library_item_id);
