ALTER TABLE collections ADD COLUMN parent_id INTEGER REFERENCES collections(id) ON DELETE RESTRICT;
CREATE INDEX idx_collections_parent_id ON collections(parent_id);
