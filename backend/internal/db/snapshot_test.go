package db

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// addMig writes a synthetic migration version into dir.
func addMig(t *testing.T, dir string, v int, upSQL string) {
	t.Helper()
	base := filepath.Join(dir, fmt.Sprintf("%06d_m", v))
	if err := os.WriteFile(base+".up.sql", []byte(upSQL), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(base+".down.sql", []byte("SELECT 1;"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func addGoodMig(t *testing.T, dir string, v int) {
	t.Helper()
	addMig(t, dir, v, fmt.Sprintf("CREATE TABLE t%d (id INTEGER PRIMARY KEY, name TEXT);", v))
}

// badRebuild fails halfway, is rolled back completely and leaves the database clean, so the
// next start retries it (a non-rebuild failure leaves the database dirty instead).
const badRebuild = RebuildMarker + "\nCREATE TABLE half (id INTEGER);\nTHIS IS NOT SQL;\n"

func snapFixture(t *testing.T) (conn *sql.DB, migDir, snapDir string) {
	t.Helper()
	conn, err := Open(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, t.TempDir(), filepath.Join(t.TempDir(), PreMigrationDirName)
}

func copies(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

func versionOf(t *testing.T, conn *sql.DB) int {
	t.Helper()
	v, _, _, err := currentVersion(conn)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func hasTable(t *testing.T, conn *sql.DB, name string) bool {
	t.Helper()
	var n int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}

func dbFile(t *testing.T, conn *sql.DB) string {
	t.Helper()
	var seq int
	var name, file string
	if err := conn.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &file); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestSnapshot_CopyIncludesWalAndHasFromVersion(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)

	// Brand-new database: migrates, no copy, no folder.
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(snapDir); !os.IsNotExist(err) {
		t.Fatalf("brand-new database must not create %s (err=%v)", snapDir, err)
	}

	// Rows that live only in the WAL (no checkpoint).
	for i := 0; i < 20; i++ {
		if _, err := conn.Exec(`INSERT INTO t1 (name) VALUES (?)`, fmt.Sprintf("row-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if st, err := os.Stat(dbFile(t, conn) + "-wal"); err != nil || st.Size() == 0 {
		t.Fatalf("expected a non-empty WAL before migrating (err=%v)", err)
	}

	addGoodMig(t, migDir, 2)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if versionOf(t, conn) != 2 {
		t.Fatal("live database was not migrated")
	}

	want := filepath.Join(snapDir, "packrat-pre-migration-v1-to-v2.db")
	if got := copies(t, snapDir); len(got) != 1 || got[0] != filepath.Base(want) {
		t.Fatalf("folder = %v, want just %s", got, filepath.Base(want))
	}

	cp, err := Open(want)
	if err != nil {
		t.Fatal(err)
	}
	var ok string
	if err := cp.QueryRow(`PRAGMA integrity_check`).Scan(&ok); err != nil || ok != "ok" {
		t.Fatalf("integrity_check = %q, %v", ok, err)
	}
	if v := versionOf(t, cp); v != 1 {
		t.Fatalf("copy version = %d, want the FROM version 1", v)
	}
	if hasTable(t, cp, "t2") {
		t.Fatal("copy contains the migrated schema")
	}
	var n int
	if err := cp.QueryRow(`SELECT COUNT(*) FROM t1 WHERE name LIKE 'row-%'`).Scan(&n); err != nil || n != 20 {
		t.Fatalf("copy has %d rows (err=%v), want 20 including those only in the WAL", n, err)
	}

	cp.Close()

	// Nothing pending now: no new copy.
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if got := copies(t, snapDir); len(got) != 1 {
		t.Fatalf("nothing pending but folder = %v", got)
	}
}

func TestSnapshot_RetentionKeepsNewestFive(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(snapDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Unrelated / non-matching entries, all older than any copy.
	old := time.Now().Add(-72 * time.Hour)
	unrelated := []string{"notes.txt", "packrat-pre-migration-v1-to-v2.db.bak", "packrat-pre-migration-vX-to-v2.db", "packrat-backup-1.json"}
	for _, n := range unrelated {
		p := filepath.Join(snapDir, n)
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(p, old, old)
	}
	dirLike := filepath.Join(snapDir, "packrat-pre-migration-v90-to-v91.db")
	if err := os.Mkdir(dirLike, 0o700); err != nil {
		t.Fatal(err)
	}

	base := time.Now().Add(-24 * time.Hour)
	for v := 2; v <= 8; v++ { // seven successful upgrades
		addGoodMig(t, migDir, v)
		if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(snapDir, fmt.Sprintf("packrat-pre-migration-v%d-to-v%d.db", v-1, v))
		ts := base.Add(time.Duration(v) * time.Minute)
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatal(err)
		}
	}

	got := map[string]bool{}
	for _, n := range copies(t, snapDir) {
		got[n] = true
	}
	for v := 4; v <= 8; v++ {
		if n := fmt.Sprintf("packrat-pre-migration-v%d-to-v%d.db", v-1, v); !got[n] {
			t.Errorf("newest copy %s was pruned", n)
		}
	}
	for v := 2; v <= 3; v++ {
		if n := fmt.Sprintf("packrat-pre-migration-v%d-to-v%d.db", v-1, v); got[n] {
			t.Errorf("old copy %s was kept", n)
		}
	}
	for _, n := range append(unrelated, filepath.Base(dirLike)) {
		if !got[n] {
			t.Errorf("unrelated entry %s was touched", n)
		}
	}
	for n := range got {
		if strings.HasPrefix(n, preMigrationTmpPrefix) {
			t.Errorf("temp file %s left behind", n)
		}
	}
}

func TestSnapshot_FailingMigrationKeepsCopyAndPrunesNothing(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(snapDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 10; i < 15; i++ { // five existing good copies
		p := filepath.Join(snapDir, fmt.Sprintf("packrat-pre-migration-v%d-to-v%d.db", i, i+1))
		os.WriteFile(p, []byte("x"), 0o600)
		ts := time.Now().Add(-time.Duration(i) * time.Hour)
		os.Chtimes(p, ts, ts)
	}

	addMig(t, migDir, 2, badRebuild)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err == nil {
		t.Fatal("expected the failing migration to return an error")
	}
	if len(copies(t, snapDir)) != 6 {
		t.Fatalf("after failure folder = %v, want 5 old + the new copy", copies(t, snapDir))
	}

	// Retrying the same pair (boot loop) replaces the file instead of adding one.
	for i := 0; i < 3; i++ {
		if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err == nil {
			t.Fatal("expected error on retry")
		}
	}
	if n := len(copies(t, snapDir)); n != 6 {
		t.Fatalf("retries changed the folder to %d entries: %v", n, copies(t, snapDir))
	}
}

func TestSnapshot_SamePairRetriedThenSucceeds(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	addMig(t, migDir, 2, badRebuild)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err == nil {
		t.Fatal("expected error")
	}
	p := filepath.Join(snapDir, "packrat-pre-migration-v1-to-v2.db")
	past := time.Now().Add(-time.Hour)
	os.Chtimes(p, past, past)

	addGoodMig(t, migDir, 2) // fixed release
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if got := copies(t, snapDir); len(got) != 1 {
		t.Fatalf("folder = %v, want one file", got)
	}
	if st, _ := os.Stat(p); !st.ModTime().After(past.Add(time.Minute)) {
		t.Fatal("copy was not replaced")
	}
}

func TestSnapshot_DirtyFailureDoesNotCopyAgain(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	addMig(t, migDir, 2, "THIS IS NOT SQL;")
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err == nil {
		t.Fatal("expected error")
	}
	if len(copies(t, snapDir)) != 1 {
		t.Fatalf("folder = %v, want the one copy", copies(t, snapDir))
	}
	// The database is now dirty: later starts report that and never add copies.
	_, err := MigrateWithSnapshot(conn, migDir, snapDir, false)
	var de *DirtyError
	if !errors.As(err, &de) || len(copies(t, snapDir)) != 1 {
		t.Fatalf("err=%v folder=%v", err, copies(t, snapDir))
	}
}

func TestSnapshot_CopyFailureDoesNotMigrate(t *testing.T) {
	conn, migDir, _ := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, filepath.Join(t.TempDir(), "x"), false); err != nil {
		t.Fatal(err)
	}
	addGoodMig(t, migDir, 2)

	// The target path is a regular file, so the folder cannot be created.
	blocker := filepath.Join(t.TempDir(), "pre-migration")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := MigrateWithSnapshot(conn, migDir, blocker, false)
	var se *SnapshotError
	if !errors.As(err, &se) {
		t.Fatalf("err = %v, want *SnapshotError", err)
	}
	for _, s := range []string{"No migration was applied", "database was not changed", "disk space", "SKIP_PRE_MIGRATION_BACKUP=true"} {
		if !strings.Contains(err.Error(), s) {
			t.Errorf("error text lacks %q: %v", s, err)
		}
	}
	if versionOf(t, conn) != 1 || hasTable(t, conn, "t2") {
		t.Fatal("migration ran although the copy failed")
	}
}

func TestSnapshot_ReadOnlyFolderDoesNotMigrate(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("permission semantics differ on Windows / root")
	}
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(snapDir, 0o500)
	t.Cleanup(func() { os.Chmod(snapDir, 0o700) })
	addGoodMig(t, migDir, 2)
	_, err := MigrateWithSnapshot(conn, migDir, snapDir, false)
	var se *SnapshotError
	if !errors.As(err, &se) || versionOf(t, conn) != 1 {
		t.Fatalf("err=%v version=%d", err, versionOf(t, conn))
	}
}

func TestSnapshot_SkipMigratesWithWarning(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, true); err != nil {
		t.Fatal(err)
	}
	addGoodMig(t, migDir, 2)

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, true); err != nil {
		t.Fatal(err)
	}
	if versionOf(t, conn) != 2 {
		t.Fatal("migration did not run")
	}
	if len(copies(t, snapDir)) != 0 {
		t.Fatal("a copy was made although skipped")
	}
	if !strings.Contains(buf.String(), "WARNING") || !strings.Contains(buf.String(), "without a safety copy") {
		t.Fatalf("no warning logged: %q", buf.String())
	}
}

func TestSnapshot_Permissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permission bits")
	}
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	_, _ = MigrateWithSnapshot(conn, migDir, snapDir, false)
	addGoodMig(t, migDir, 2)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(snapDir)
	if err != nil || st.Mode().Perm() != 0o700 {
		t.Fatalf("folder mode = %v (err=%v), want 0700", st.Mode().Perm(), err)
	}
	f, err := os.Stat(filepath.Join(snapDir, "packrat-pre-migration-v1-to-v2.db"))
	if err != nil || f.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %v (err=%v), want 0600", f.Mode().Perm(), err)
	}
}
