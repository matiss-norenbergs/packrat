package db

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database"
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
//
// Files whose first non-empty line is RebuildMarker are the exception: they
// run in one transaction with foreign_keys switched off outside it (see
// rebuild.go), and a failed one rolls back completely and clears the dirty
// flag itself. Every other file keeps the NoTxWrap behavior described above.
func Migrate(conn *sql.DB, migrationsDir string) error {
	m, err := newMigrator(conn, migrationsDir)
	if err != nil {
		return err
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		var dirty migrate.ErrDirty
		if errors.As(err, &dirty) {
			return &DirtyError{Version: dirty.Version}
		}
		return fmt.Errorf("applying migrations: %w", err)
	}
	return nil
}

// newMigrator builds the migrator with the rebuild-aware driver, after
// clearing a dirty flag left by an interrupted rebuild migration.
func newMigrator(conn *sql.DB, migrationsDir string) (*migrate.Migrate, error) {
	inner, err := sqlite.WithInstance(conn, &sqlite.Config{NoTxWrap: true})
	if err != nil {
		return nil, fmt.Errorf("creating migrate driver: %w", err)
	}
	driver := &rebuildDriver{Driver: inner, db: conn}

	if err := clearInterruptedRebuild(driver, migrationsDir); err != nil {
		return nil, err
	}

	sourceURL := "file://" + filepath.ToSlash(migrationsDir)
	m, err := migrate.NewWithDatabaseInstance(sourceURL, "sqlite", driver)
	if err != nil {
		return nil, fmt.Errorf("creating migrator: %w", err)
	}
	return m, nil
}

// clearInterruptedRebuild handles a database left dirty by a killed process.
// A marked rebuild migration is transactional, so if one was interrupted the
// schema is still at the previous version and the flag can safely be reset
// (the run that follows then applies it again). Dirty at any other version is
// never repaired automatically: the caller gets a DirtyError.
//
// Migrate only ever runs migrations upward, so a dirty row is read as an
// interrupted up migration of that version.
func clearInterruptedRebuild(drv *rebuildDriver, dir string) error {
	version, dirty, err := drv.Version()
	if err != nil {
		return fmt.Errorf("reading migration version: %w", err)
	}
	if !dirty {
		return nil
	}
	ups, err := upMigrations(dir)
	if err != nil {
		return fmt.Errorf("reading migrations: %w", err)
	}
	path, ok := ups[version]
	if !ok || !isRebuildFile(path) {
		return &DirtyError{Version: version}
	}
	prev := database.NilVersion
	for v := range ups {
		if v < version && v > prev {
			prev = v
		}
	}
	log.Printf("migration %d is a rebuild migration that was interrupted; it was rolled back, resetting to version %d", version, prev)
	if err := drv.Driver.SetVersion(prev, false); err != nil {
		return fmt.Errorf("resetting interrupted migration %d: %w", version, err)
	}
	return nil
}
