-- packrat:rebuild
-- Restricts the FTS update trigger to the six indexed columns. Without a
-- column list, every UPDATE of library (a playback-position heartbeat, a
-- thumbnail path, ...) deleted and re-inserted the item's library_fts row.
-- UPDATE OF fires only when one of these columns is named in the statement's
-- SET clause. The body is unchanged.
--
-- The marker is used for atomicity, not for a table rebuild: DROP TRIGGER
-- followed by CREATE TRIGGER is two statements, and a crash between them
-- would leave no library_au and search silently stale.
DROP TRIGGER library_au;

CREATE TRIGGER library_au
AFTER UPDATE OF title, filename, uploader, description, folder, original_url ON library BEGIN
  INSERT INTO library_fts(library_fts, rowid, title, filename, uploader, description, folder, original_url)
  VALUES ('delete', old.id, old.title, old.filename, old.uploader, old.description, old.folder, old.original_url);
  INSERT INTO library_fts(rowid, title, filename, uploader, description, folder, original_url)
  VALUES (new.id, new.title, new.filename, new.uploader, new.description, new.folder, new.original_url);
END;
