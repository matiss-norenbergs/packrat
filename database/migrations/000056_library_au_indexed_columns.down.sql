-- packrat:rebuild
-- Restores the unrestricted library_au trigger (fires on any UPDATE of
-- library), exactly as 000044_image_download_type left it. Marked so the
-- drop and the create are one transaction.
DROP TRIGGER library_au;

CREATE TRIGGER library_au AFTER UPDATE ON library BEGIN
  INSERT INTO library_fts(library_fts, rowid, title, filename, uploader, description, folder, original_url)
  VALUES ('delete', old.id, old.title, old.filename, old.uploader, old.description, old.folder, old.original_url);
  INSERT INTO library_fts(rowid, title, filename, uploader, description, folder, original_url)
  VALUES (new.id, new.title, new.filename, new.uploader, new.description, new.folder, new.original_url);
END;
