CREATE VIRTUAL TABLE library_fts USING fts5(
    title, filename, uploader, description, folder, original_url,
    content='library', content_rowid='id'
);

INSERT INTO library_fts(rowid, title, filename, uploader, description, folder, original_url)
SELECT id, title, filename, uploader, description, folder, original_url FROM library;

CREATE TRIGGER library_ai AFTER INSERT ON library BEGIN
  INSERT INTO library_fts(rowid, title, filename, uploader, description, folder, original_url)
  VALUES (new.id, new.title, new.filename, new.uploader, new.description, new.folder, new.original_url);
END;

CREATE TRIGGER library_ad AFTER DELETE ON library BEGIN
  INSERT INTO library_fts(library_fts, rowid, title, filename, uploader, description, folder, original_url)
  VALUES ('delete', old.id, old.title, old.filename, old.uploader, old.description, old.folder, old.original_url);
END;

CREATE TRIGGER library_au AFTER UPDATE ON library BEGIN
  INSERT INTO library_fts(library_fts, rowid, title, filename, uploader, description, folder, original_url)
  VALUES ('delete', old.id, old.title, old.filename, old.uploader, old.description, old.folder, old.original_url);
  INSERT INTO library_fts(rowid, title, filename, uploader, description, folder, original_url)
  VALUES (new.id, new.title, new.filename, new.uploader, new.description, new.folder, new.original_url);
END;

-- Indexes on collection_id/status/downloaded_at/original_url/video_id already
-- exist from 000001_init and 000005_library_nullable_original_url — nothing
-- to add here.
