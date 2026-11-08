package api

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/db"
)

// TestMain makes the package's tests cheaper without changing what they check:
//   - password hashing runs at bcrypt.MinCost (see bcryptCost) — at the default
//     cost one hash costs ~0.7 s under -race and the login fixtures do several;
//   - the migrated database is built once and copied per test (openMigratedTestDB).
func TestMain(m *testing.M) {
	bcryptCost = bcrypt.MinCost
	// The login-uniformity dummy hash was built at package init, at the default
	// cost; rebuild it at the cost the test hashes use so both paths stay alike.
	h, err := bcrypt.GenerateFromPassword([]byte("packrat-dummy-password"), bcryptCost)
	if err != nil {
		panic(err)
	}
	dummyPasswordHash = h

	code := m.Run()
	if templateDBDir != "" {
		os.RemoveAll(templateDBDir)
	}
	os.Exit(code)
}

var (
	templateDBOnce sync.Once
	templateDBDir  string
	templateDBPath string
	templateDBErr  error
)

// buildTemplateDB migrates one database from scratch (the ~1 s step under -race)
// and leaves it as a single self-contained file: the WAL is checkpointed and the
// connection closed, so a plain file copy is a complete, migrated database.
func buildTemplateDB() {
	templateDBDir, templateDBErr = os.MkdirTemp("", "packrat-api-template-")
	if templateDBErr != nil {
		return
	}
	templateDBPath = filepath.Join(templateDBDir, "template.db")
	conn, err := db.Open(templateDBPath)
	if err != nil {
		templateDBErr = err
		return
	}
	defer conn.Close()
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		templateDBErr = err
		return
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		templateDBErr = fmt.Errorf("migrating template db: %w", err)
		return
	}
	if _, err := conn.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		templateDBErr = fmt.Errorf("checkpointing template db: %w", err)
	}
}

// openMigratedTestDB returns a fresh, fully migrated database in the test's own
// temp dir, closed again when the test ends. Equivalent to db.Open + db.Migrate
// on an empty file, but the migrations run once per test binary instead of once
// per test.
func openMigratedTestDB(t testing.TB) *sql.DB {
	t.Helper()
	templateDBOnce.Do(buildTemplateDB)
	if templateDBErr != nil {
		t.Fatalf("building template test db: %v", templateDBErr)
	}
	dst := filepath.Join(t.TempDir(), "packrat_test.db")
	src, err := os.Open(templateDBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	conn, err := db.Open(dst)
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}
