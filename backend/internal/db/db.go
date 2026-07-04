package db

import (
	"database/sql"
	"fmt"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "modernc.org/sqlite"
)

// Open opens the SQLite database at path with WAL mode and a busy timeout so
// frequent progress-related reads never contend with the single writer.
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)", path)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}
	conn.SetMaxOpenConns(1) // modernc sqlite is not safe for concurrent writers; serialize access
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}
	return conn, nil
}

// Migrate applies all pending migrations from migrationsDir against conn.
//
// NoTxWrap is required, not just a preference: golang-migrate otherwise runs
// each migration file inside its own transaction, and SQLite's PRAGMA
// foreign_keys is a documented no-op inside a transaction. Table-rebuild
// migrations (the only way to change a column constraint in SQLite) rely on
// disabling foreign_keys around the rebuild — SQLite's DROP TABLE performs
// an implicit "DELETE FROM" first when foreign_keys is on, which fires any
// ON DELETE actions (SET NULL / CASCADE / RESTRICT) declared on *other*
// tables that reference the one being dropped. Without NoTxWrap, that
// implicit delete cannot be suppressed and silently corrupts sibling tables
// (e.g. nulling out every downloads/library row's collection_id).
func Migrate(conn *sql.DB, migrationsDir string) error {
	driver, err := sqlite.WithInstance(conn, &sqlite.Config{NoTxWrap: true})
	if err != nil {
		return fmt.Errorf("creating migrate driver: %w", err)
	}

	sourceURL := "file://" + filepath.ToSlash(migrationsDir)
	m, err := migrate.NewWithDatabaseInstance(sourceURL, "sqlite", driver)
	if err != nil {
		return fmt.Errorf("creating migrator: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("applying migrations: %w", err)
	}
	return nil
}
