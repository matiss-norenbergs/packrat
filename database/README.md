# Database Migrations

SQLite schema lives here as versioned migration files, applied automatically by the backend on
startup via [`golang-migrate`](https://github.com/golang-migrate/migrate) — never hand-edit the
schema in a running database.

## Adding a migration

Create a new numbered pair of files:

```
NNNNNN_description.up.sql
NNNNNN_description.down.sql
```

`NNNNNN` is a zero-padded, strictly increasing sequence number (e.g. `000002`). The `up` file
applies the change; the `down` file must fully reverse it.

## Applying manually (for testing)

```
migrate -path database/migrations -database "sqlite3://path/to/packrat.db" up
```

The backend runs migrations automatically on every startup — manual application is only needed
for debugging or ad-hoc verification against a throwaway database file.
