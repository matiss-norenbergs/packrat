DROP INDEX IF EXISTS idx_downloads_ghost_library_item_id;
ALTER TABLE downloads DROP COLUMN ghost_library_item_id;
