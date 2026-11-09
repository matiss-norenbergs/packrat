package db

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database"
	migratesqlite "github.com/golang-migrate/migrate/v4/database/sqlite"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

const (
	// MaxOpenConns is the size of the connection pool. Reads (WAL snapshots) run
	// concurrently on separate connections; writes still take turns, one at a
	// time, through SQLite's write lock. Small on purpose: SQLite gains nothing
	// from many writers, and every connection costs a page cache.
	MaxOpenConns = 8

	// BusyTimeout is how long a statement waits for another connection's write
	// lock before failing with SQLITE_BUSY ("database is locked"). Handlers map
	// that failure to 503 (see IsBusy).
	BusyTimeout = 15 * time.Second
)

// Open opens the SQLite database at path as a pool of MaxOpenConns connections.
//
// Every connection the pool opens gets the same setup from the DSN (the driver
// runs each _pragma on each new connection, not just the first): WAL, a busy
// timeout, and foreign keys on. busy_timeout comes first so the journal-mode
// change itself waits instead of failing; _txlock=immediate makes every
// transaction started through database/sql take the write lock at BEGIN. A
// deferred transaction that reads and then writes would otherwise fail
// instantly with SQLITE_BUSY (busy_timeout does not apply to that lock
// upgrade) whenever another connection committed in between. Read-only
// transactions (sql.TxOptions{ReadOnly: true}) stay deferred.
//
// Anything else that is per connection (other PRAGMAs, ATTACH, temp tables)
// must run on one pinned *sql.Conn; see rebuild.go.
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(%d)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)&_txlock=immediate",
		path, BusyTimeout.Milliseconds())
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}
	conn.SetMaxOpenConns(MaxOpenConns)
	conn.SetMaxIdleConns(MaxOpenConns) // keep the connections (and their page caches) instead of re-opening
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}
	return conn, nil
}

// IsBusy reports whether err is SQLite's "database is locked" condition
// (SQLITE_BUSY or SQLITE_LOCKED, including their extended codes): a write could
// not get the write lock within BusyTimeout. It is transient; callers answer
// 503 or retry rather than treating it as a bug.
func IsBusy(err error) bool {
	if err == nil {
		return false
	}
	var se *sqlite.Error
	if errors.As(err, &se) {
		switch se.Code() & 0xff {
		case sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED:
			return true
		}
		return false
	}
	return strings.Contains(err.Error(), "database is locked")
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
// With a connection pool, an unmarked file still runs as ONE Exec and so on one
// connection (a PRAGMA foreign_keys inside it is restored by the file itself);
// golang-migrate's own lock is an in-process flag, not a database lock, and it
// applies files strictly one after another, so nothing else touches the schema
// while Migrate runs (it is called before the server starts serving).
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
	inner, err := migratesqlite.WithInstance(conn, &migratesqlite.Config{NoTxWrap: true})
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
