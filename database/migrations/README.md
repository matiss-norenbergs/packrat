# Migrations

Numbered `NNNNNN_name.up.sql` / `.down.sql` pairs, applied automatically at startup by
`backend/internal/db` (golang-migrate, one file at a time, no wrapping transaction).

## Table-rebuild migrations: start the file with `-- packrat:rebuild`

SQLite cannot change a column constraint in place, so such a change means: create `X_new`, copy,
`DROP TABLE X`, rename. Use the marker for **any** migration that needs `DROP TABLE` / a rebuild.

The first non-empty line must be exactly:

```sql
-- packrat:rebuild
```

The runner then executes the file with foreign keys off (outside the transaction, where the
pragma works), inside one transaction, and checks `PRAGMA foreign_key_check` before committing.
Any error or foreign-key violation rolls the whole file back, resets the version row to the
previous version (not dirty) and fails the migration, so a retry on the next boot just works.
Works for `.up.sql` and `.down.sql`.

Rules for a marked file (the runner rejects violations before running anything):

- No `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` (trigger bodies may use `BEGIN … END`).
- No `PRAGMA foreign_keys` — the runner owns it.
- `DROP TABLE` also drops that table's **indexes and triggers**: recreate them in the file
  (see the comment in `000044_image_download_type.up.sql`).
- Other tables' `REFERENCES` to the rebuilt table need no change — the name is the same after the
  rename.

Unmarked files run exactly as before (no transaction; a `PRAGMA foreign_keys` inside takes
effect). Do not use that for rebuilds: a failure partway leaves a dirty database that needs a
backup restore. Migrations 000004, 000005 and 000044 predate the marker and are intentionally
left as they are (already applied everywhere).

The golang-migrate CLI (`scripts/migrate.sh`) does not know the marker; it would run a marked
file as plain SQL without the transaction or the pragmas. Use the server for rebuild migrations.
