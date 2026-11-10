package db

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite"
)

const initSQL = `
CREATE TABLE parents (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE kids  (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE);
CREATE TABLE notes (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id) ON DELETE SET NULL);
CREATE TRIGGER parents_ai AFTER INSERT ON parents BEGIN SELECT 1; END;
`

const rebuildUp = `-- packrat:rebuild
CREATE TABLE parents_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, extra TEXT NOT NULL DEFAULT 'x');
INSERT INTO parents_new (id, name) SELECT id, name FROM parents;
DROP TABLE parents;
ALTER TABLE parents_new RENAME TO parents;
CREATE TRIGGER parents_ai AFTER INSERT ON parents
BEGIN
  SELECT 1;
END;
`

func openTest(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustExec(t *testing.T, conn *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func versionRow(t *testing.T, conn *sql.DB) (int, bool) {
	t.Helper()
	var v int
	var dirty bool
	if err := conn.QueryRow("SELECT version, dirty FROM schema_migrations").Scan(&v, &dirty); err != nil {
		t.Fatal(err)
	}
	return v, dirty
}

func count(t *testing.T, conn *sql.DB, q string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(q).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

// seeded returns a db migrated to version 1 with parent 1 owning one kid and
// one note, plus the migrations dir.
func seeded(t *testing.T) (*sql.DB, string) {
	t.Helper()
	conn, dir := openTest(t), t.TempDir()
	writeFile(t, dir, "000001_init.up.sql", initSQL)
	writeFile(t, dir, "000001_init.down.sql", "DROP TABLE notes; DROP TABLE kids; DROP TABLE parents;")
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	mustExec(t, conn, "INSERT INTO parents (id, name) VALUES (1, 'p')")
	mustExec(t, conn, "INSERT INTO kids (id, parent_id) VALUES (1, 1)")
	mustExec(t, conn, "INSERT INTO notes (id, parent_id) VALUES (1, 1)")
	return conn, dir
}

// pinAllConns pins every connection the pool can hold at the same time, so a
// check can look at each connection's own state: PRAGMA foreign_keys belongs to
// a connection, and a plain conn.QueryRow lands on an arbitrary one.
//
// The caller must call the returned release before pinning again (and before
// the pool is needed for anything else): the connections are all in use until
// then.
func pinAllConns(t *testing.T, conn *sql.DB) (conns []*sql.Conn, release func()) {
	t.Helper()
	ctx := context.Background()
	var pinned []*sql.Conn
	for i := 0; i < MaxOpenConns; i++ {
		c, err := conn.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		pinned = append(pinned, c)
	}
	release = func() {
		for _, c := range pinned {
			c.Close()
		}
	}
	t.Cleanup(release) // Close on an already-closed Conn is a harmless error
	return pinned, release
}

func pragmaInt(t *testing.T, c *sql.Conn, pragma string) int {
	t.Helper()
	var n int
	if err := c.QueryRowContext(context.Background(), pragma).Scan(&n); err != nil {
		t.Fatalf("%s: %v", pragma, err)
	}
	return n
}

// assertHealthy checks that EVERY pooled connection has foreign keys on and no
// open transaction.
func assertHealthy(t *testing.T, conn *sql.DB) {
	t.Helper()
	conns, release := pinAllConns(t, conn)
	defer release()
	for i, c := range conns {
		if n := pragmaInt(t, c, "PRAGMA foreign_keys"); n != 1 {
			t.Errorf("connection %d: foreign_keys = %d, want 1", i, n)
		}
		if _, err := c.ExecContext(context.Background(), "BEGIN"); err != nil {
			t.Errorf("connection %d still in a transaction: %v", i, err)
		} else if _, err := c.ExecContext(context.Background(), "ROLLBACK"); err != nil {
			t.Errorf("connection %d: %v", i, err)
		}
	}
}

func TestRealMigrationsMatchPlainDriver(t *testing.T) {
	dir, _ := filepath.Abs("../../../database/migrations")

	got := openTest(t)
	if err := Migrate(got, dir); err != nil {
		t.Fatal(err)
	}
	want := openTest(t)
	drv, err := sqlite.WithInstance(want, &sqlite.Config{NoTxWrap: true})
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.NewWithDatabaseInstance("file://"+filepath.ToSlash(dir), "sqlite", drv)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}

	schema := func(c *sql.DB) string {
		rows, err := c.Query("SELECT type, name, COALESCE(sql,'') FROM sqlite_master ORDER BY type, name")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var b strings.Builder
		for rows.Next() {
			var a, n, s string
			if err := rows.Scan(&a, &n, &s); err != nil {
				t.Fatal(err)
			}
			b.WriteString(a + "|" + n + "|" + s + "\n")
		}
		return b.String()
	}
	if schema(got) != schema(want) {
		t.Error("schema differs from the plain NoTxWrap driver")
	}
	gv, gd := versionRow(t, got)
	wv, wd := versionRow(t, want)
	if gv != wv || gd || wd {
		t.Errorf("versions got %d/%v want %d/%v", gv, gd, wv, wd)
	}
	assertHealthy(t, got)

	// Second run is a no-op.
	if err := Migrate(got, dir); err != nil {
		t.Fatal(err)
	}
}

func TestRebuildSucceedsAndKeepsSiblings(t *testing.T) {
	conn, dir := seeded(t)
	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp)
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM parents WHERE extra = 'x'"); n != 1 {
		t.Errorf("parents rebuilt rows = %d", n)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM kids"); n != 1 {
		t.Errorf("ON DELETE CASCADE child rows = %d, want 1 (DROP TABLE must not cascade)", n)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM notes WHERE parent_id = 1"); n != 1 {
		t.Errorf("ON DELETE SET NULL child kept parent_id = %d rows, want 1", n)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='parents_ai'"); n != 1 {
		t.Error("trigger not recreated")
	}
	if v, d := versionRow(t, conn); v != 2 || d {
		t.Errorf("version %d dirty %v", v, d)
	}
	assertHealthy(t, conn)
}

func TestRebuildFailingHalfwayRollsBackAndRetries(t *testing.T) {
	conn, dir := seeded(t)
	before := count(t, conn, "SELECT COUNT(*) FROM sqlite_master")
	bad := strings.Replace(rebuildUp, "CREATE TRIGGER", "SELECT * FROM does_not_exist;\nCREATE TRIGGER", 1)
	writeFile(t, dir, "000002_rebuild.up.sql", bad)

	err := Migrate(conn, dir)
	if err == nil || !strings.Contains(err.Error(), "does_not_exist") {
		t.Fatalf("err = %v", err)
	}
	if v, d := versionRow(t, conn); v != 1 || d {
		t.Errorf("version %d dirty %v, want 1 clean", v, d)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master"); n != before {
		t.Errorf("schema objects %d, want %d", n, before)
	}
	for _, tbl := range []string{"parents", "kids", "notes"} {
		if n := count(t, conn, "SELECT COUNT(*) FROM "+tbl); n != 1 {
			t.Errorf("%s rows = %d, want 1", tbl, n)
		}
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='parents_new'"); n != 0 {
		t.Error("parents_new left behind")
	}
	assertHealthy(t, conn)

	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp)
	if err := Migrate(conn, dir); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if v, d := versionRow(t, conn); v != 2 || d {
		t.Errorf("after retry version %d dirty %v", v, d)
	}
}

func TestRebuildForeignKeyViolationNamesTable(t *testing.T) {
	conn, dir := seeded(t)
	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp+"INSERT INTO kids (id, parent_id) VALUES (2, 999);\n")
	err := Migrate(conn, dir)
	if err == nil || !strings.Contains(err.Error(), "kids") {
		t.Fatalf("err = %v, want one naming kids", err)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM kids"); n != 1 {
		t.Errorf("kids = %d, want rolled back to 1", n)
	}
	if v, d := versionRow(t, conn); v != 1 || d {
		t.Errorf("version %d dirty %v", v, d)
	}
	assertHealthy(t, conn)
}

func TestRebuildRejectsTransactionControl(t *testing.T) {
	cases := map[string]string{
		"begin":    "BEGIN;\nCREATE TABLE a(x);\n",
		"commit":   "CREATE TABLE a(x);\nCOMMIT;\n",
		"end":      "CREATE TABLE a(x);\nEND TRANSACTION;\n",
		"pragma":   "PRAGMA foreign_keys = OFF;\nCREATE TABLE a(x);\n",
		"pragma2":  "pragma main.foreign_keys=on;\n",
		"savepont": "SAVEPOINT s;\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			conn, dir := seeded(t)
			writeFile(t, dir, "000002_x.up.sql", "-- packrat:rebuild\n"+body)
			err := Migrate(conn, dir)
			if err == nil || !strings.Contains(err.Error(), "rebuild migration must not") {
				t.Fatalf("err = %v", err)
			}
			if v, d := versionRow(t, conn); v != 1 || d {
				t.Errorf("version %d dirty %v", v, d)
			}
			if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='a'"); n != 0 {
				t.Error("file partly ran")
			}
		})
	}
	// Words inside comments, strings and triggers are fine.
	if err := validateRebuildBody("-- COMMIT\nSELECT 'begin; commit';\n/* PRAGMA foreign_keys */\n" + rebuildUp); err != nil {
		t.Errorf("false positive: %v", err)
	}
	if err := validateRebuildBody("PRAGMA foreign_key_check;"); err != nil {
		t.Errorf("foreign_key_check rejected: %v", err)
	}
}

func TestDirtyAtMarkedMigrationIsReset(t *testing.T) {
	conn, dir := seeded(t)
	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp)
	// Simulate a process killed after golang-migrate marked 2 dirty.
	mustExec(t, conn, "DELETE FROM schema_migrations")
	mustExec(t, conn, "INSERT INTO schema_migrations (version, dirty) VALUES (2, 1)")

	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	if v, d := versionRow(t, conn); v != 2 || d {
		t.Errorf("version %d dirty %v", v, d)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM parents WHERE extra = 'x'"); n != 1 {
		t.Error("migration not applied")
	}
}

func TestDirtyAtFirstMarkedMigrationResetsToNil(t *testing.T) {
	conn, dir := openTest(t), t.TempDir()
	writeFile(t, dir, "000001_init.up.sql", "-- packrat:rebuild\nCREATE TABLE a (id INTEGER);\n")
	if _, err := sqlite.WithInstance(conn, &sqlite.Config{NoTxWrap: true}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, conn, "INSERT INTO schema_migrations (version, dirty) VALUES (1, 1)")
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	if v, d := versionRow(t, conn); v != 1 || d {
		t.Errorf("version %d dirty %v", v, d)
	}
}

func TestDirtyAtUnmarkedMigrationExplains(t *testing.T) {
	conn, dir := seeded(t)
	mustExec(t, conn, "UPDATE schema_migrations SET dirty = 1")

	err := Migrate(conn, dir)
	var de *DirtyError
	if !errors.As(err, &de) || de.Version != 1 {
		t.Fatalf("err = %v, want DirtyError at 1", err)
	}
	for _, want := range []string{"version 1", "did not finish", "will not start", "backup", "data/db", "data/backups"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("message lacks %q: %s", want, err)
		}
	}
	if v, d := versionRow(t, conn); v != 1 || !d {
		t.Errorf("row changed: %d %v", v, d)
	}
}

func TestUnmarkedMigrationKeepsOldBehavior(t *testing.T) {
	conn, dir := seeded(t)
	// PRAGMA foreign_keys = OFF must take effect (no transaction wrapper), and
	// a mid-file failure must leave the earlier statements applied and the
	// database dirty, exactly as before.
	writeFile(t, dir, "000002_plain.up.sql", "PRAGMA foreign_keys = OFF;\nCREATE TABLE plain (x);\nSELECT * FROM nope;\n")
	if err := Migrate(conn, dir); err == nil {
		t.Fatal("expected failure")
	}
	// The pragma belongs to the one connection that ran the file; the others
	// are untouched.
	off := 0
	conns, release := pinAllConns(t, conn)
	for _, c := range conns {
		if pragmaInt(t, c, "PRAGMA foreign_keys") == 0 {
			off++
		}
	}
	release()
	if off != 1 {
		t.Errorf("%d connections have foreign_keys off, want exactly 1 (PRAGMA took effect, no tx, on one connection)", off)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='plain'"); n != 1 {
		t.Error("unmarked file ran in a transaction")
	}
	if v, d := versionRow(t, conn); v != 2 || !d {
		t.Errorf("version %d dirty %v, want 2 dirty", v, d)
	}
	if err := Migrate(conn, dir); !errors.As(err, new(*DirtyError)) {
		t.Errorf("second run err = %v", err)
	}
}

func TestMarkedDownMigrations(t *testing.T) {
	conn, dir := seeded(t)
	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp)
	down := `-- packrat:rebuild
CREATE TABLE parents_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO parents_new (id, name) SELECT id, name FROM parents;
DROP TABLE parents;
ALTER TABLE parents_new RENAME TO parents;
`
	writeFile(t, dir, "000002_rebuild.down.sql", down+"SELECT * FROM does_not_exist;\n")
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	m, err := newMigrator(conn, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Steps(-1); err == nil {
		t.Fatal("expected failing down")
	}
	if v, d := versionRow(t, conn); v != 2 || d {
		t.Errorf("after failed down: version %d dirty %v, want 2 clean", v, d)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM kids"); n != 1 {
		t.Errorf("kids = %d", n)
	}
	assertHealthy(t, conn)

	writeFile(t, dir, "000002_rebuild.down.sql", down)
	m, err = newMigrator(conn, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Steps(-1); err != nil {
		t.Fatal(err)
	}
	if v, d := versionRow(t, conn); v != 1 || d {
		t.Errorf("after down: version %d dirty %v", v, d)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM pragma_table_info('parents') WHERE name='extra'"); n != 0 {
		t.Error("column not removed")
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM kids"); n != 1 {
		t.Errorf("kids = %d", n)
	}
	assertHealthy(t, conn)
}
