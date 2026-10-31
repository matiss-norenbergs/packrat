-- The Library sort is no longer a global setting: it is a working choice that starts from the
-- account's saved `library` table layout (user_table_layouts). Drop the old row.
DELETE FROM settings WHERE key = 'library_sort';
