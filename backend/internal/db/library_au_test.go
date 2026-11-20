package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const (
	libraryAuUpFile   = "000056_library_au_indexed_columns.up.sql"
	libraryAuDownFile = "000056_library_au_indexed_columns.down.sql"
)

var indexedColumns = []string{"title", "filename", "uploader", "description", "folder", "original_url"}

func realMigrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// stagedDir copies the real migrations into a fresh dir, leaving out the
// library_au migration, so a database can be brought to the previous version
// first. The returned add function then copies the two files in.
func stagedDir(t *testing.T) (dir string, add func()) {
	t.Helper()
	src := realMigrationsDir(t)
	dir = t.TempDir()
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatal(err)
	}
	var held []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		if e.Name() == libraryAuUpFile || e.Name() == libraryAuDownFile {
			held = append(held, e.Name())
			continue
		}
		b, err := os.ReadFile(filepath.Join(src, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		writeFile(t, dir, e.Name(), string(b))
	}
	if len(held) != 2 {
		t.Fatalf("library_au migration files not found in %s", src)
	}
	return dir, func() {
		for _, n := range held {
			b, err := os.ReadFile(filepath.Join(src, n))
			if err != nil {
				t.Fatal(err)
			}
			writeFile(t, dir, n, string(b))
		}
	}
}

// previousVersionDB returns a database migrated to the version before the
// library_au change, plus a function that stages the change for Migrate.
func previousVersionDB(t *testing.T) (*sql.DB, string, func()) {
	t.Helper()
	conn := openTest(t)
	dir, add := stagedDir(t)
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	return conn, dir, add
}

func triggerSQL(t *testing.T, conn *sql.DB, name string) string {
	t.Helper()
	var s string
	if err := conn.QueryRow("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", name).Scan(&s); err != nil {
		t.Fatalf("trigger %s: %v", name, err)
	}
	return s
}

func isRestricted(s string) bool {
	l := strings.ToLower(strings.Join(strings.Fields(s), " "))
	return strings.Contains(l, "after update of title, filename, uploader, description, folder, original_url on library")
}

func addItem(t *testing.T, conn *sql.DB, title string) int64 {
	t.Helper()
	res, err := conn.Exec(`INSERT INTO library (title, filename, path, folder, original_url, uploader, description)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		title, "file"+title+".mp4", "/m/"+title+".mp4", "folder"+title, "http://x/"+title, "up"+title, "desc"+title)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func search(t *testing.T, conn *sql.DB, term string) []int64 {
	t.Helper()
	rows, err := conn.Query(`SELECT rowid FROM library_fts WHERE library_fts MATCH ? ORDER BY rowid`, term)
	if err != nil {
		t.Fatalf("search %q: %v", term, err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func searchSnapshot(t *testing.T, conn *sql.DB, terms []string) map[string][]int64 {
	t.Helper()
	out := map[string][]int64{}
	for _, term := range terms {
		out[term] = search(t, conn, term)
	}
	return out
}

func seedLibrary(t *testing.T, conn *sql.DB, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		addItem(t, conn, fmt.Sprintf("alpha%d", i))
	}
}

// updateDelta runs one statement and returns the growth of total_changes(),
// which (unlike changes()) counts the rows written by trigger programs.
func updateDelta(t *testing.T, conn *sql.DB, q string, args ...any) int {
	t.Helper()
	ctx := context.Background()
	c, err := conn.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var before, after int
	if err := c.QueryRowContext(ctx, "SELECT total_changes()").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ExecContext(ctx, q, args...); err != nil {
		t.Fatal(err)
	}
	if err := c.QueryRowContext(ctx, "SELECT total_changes()").Scan(&after); err != nil {
		t.Fatal(err)
	}
	return after - before
}

func containsID(ids []int64, id int64) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

func TestLibraryAu_UpRestrictsToIndexedColumns(t *testing.T) {
	conn, dir, add := previousVersionDB(t)
	if isRestricted(triggerSQL(t, conn, "library_au")) {
		t.Fatal("precondition: previous version should have the unrestricted trigger")
	}
	add()
	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	if s := triggerSQL(t, conn, "library_au"); !isRestricted(s) {
		t.Errorf("library_au is not restricted to the six columns:\n%s", s)
	}
	for _, name := range []string{"library_ai", "library_ad"} {
		if n := count(t, conn, "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='"+name+"'"); n != 1 {
			t.Errorf("%s missing", name)
		}
	}
	if v, d := versionRow(t, conn); v < 56 || d {
		t.Errorf("version %d dirty %v", v, d)
	}
	assertHealthy(t, conn)
}

func TestLibraryAu_EachIndexedColumnStaysSearchable(t *testing.T) {
	conn := openTest(t)
	if err := Migrate(conn, realMigrationsDir(t)); err != nil {
		t.Fatal(err)
	}
	id := addItem(t, conn, "base")
	other := addItem(t, conn, "other")

	if got := search(t, conn, "upbase"); !reflect.DeepEqual(got, []int64{id}) {
		t.Fatalf("after insert: %v", got)
	}
	oldTerms := map[string]string{
		"title": "base", "filename": "filebase", "uploader": "upbase",
		"description": "descbase", "folder": "folderbase", "original_url": "base",
	}
	for _, col := range indexedColumns {
		oldTerm := oldTerms[col]
		newTerm := "zz" + strings.ReplaceAll(col, "_", "") + "qq"
		if got := search(t, conn, col+" : "+oldTerm); !containsID(got, id) {
			t.Fatalf("%s: old value %q not found before update: %v", col, oldTerm, got)
		}
		mustExec(t, conn, "UPDATE library SET "+col+" = ? WHERE id = ?", newTerm, id)
		if got := search(t, conn, col+" : "+newTerm); !reflect.DeepEqual(got, []int64{id}) {
			t.Errorf("%s: new value not searchable: %v", col, got)
		}
		if got := search(t, conn, col+" : "+oldTerm); containsID(got, id) {
			t.Errorf("%s: old value %q still matches item %d", col, oldTerm, id)
		}
	}
	if got := search(t, conn, "upother"); !reflect.DeepEqual(got, []int64{other}) {
		t.Errorf("other row: %v", got)
	}
	mustExec(t, conn, "DELETE FROM library WHERE id = ?", id)
	if got := search(t, conn, "zzuploaderqq"); len(got) != 0 {
		t.Errorf("after delete: %v", got)
	}
	if _, err := conn.Exec("INSERT INTO library_fts(library_fts) VALUES('integrity-check')"); err != nil {
		t.Errorf("fts integrity-check: %v", err)
	}
}

// A write to an unindexed column must not touch the index. The old
// unrestricted trigger shows up as a bigger total_changes() delta, so the
// test fails against it.
func TestLibraryAu_UnindexedWriteDoesNotTouchIndex(t *testing.T) {
	const q = "UPDATE library SET playback_position_seconds = ?, last_watched_at = datetime('now') WHERE id = ?"

	oldConn, _, _ := previousVersionDB(t)
	oldID := addItem(t, oldConn, "old")
	oldDelta := updateDelta(t, oldConn, q, 42, oldID)
	if oldDelta <= 1 {
		t.Fatalf("old trigger: delta = %d, want > 1 (the test could not tell the triggers apart)", oldDelta)
	}

	conn := openTest(t)
	if err := Migrate(conn, realMigrationsDir(t)); err != nil {
		t.Fatal(err)
	}
	id := addItem(t, conn, "new")
	if d := updateDelta(t, conn, q, 42, id); d != 1 {
		t.Errorf("playback update: delta = %d, want 1 (old trigger gave %d)", d, oldDelta)
	}
	for _, u := range []string{
		"UPDATE library SET thumbnail = 'a.jpg' WHERE id = ?",
		"UPDATE library SET collection_id = NULL, status = 'completed', file_size_bytes = 5 WHERE id = ?",
	} {
		if d := updateDelta(t, conn, u, id); d != 1 {
			t.Errorf("%s: delta = %d, want 1", u, d)
		}
	}
	if d := updateDelta(t, conn, "UPDATE library SET title = 'renamed' WHERE id = ?", id); d <= 1 {
		t.Errorf("title update: delta = %d, want > 1", d)
	}
	if d := updateDelta(t, conn, "UPDATE library SET duration = 9, uploader = 'someone' WHERE id = ?", id); d <= 1 {
		t.Errorf("mixed update: delta = %d, want > 1", d)
	}
	if got := search(t, conn, "someone"); !reflect.DeepEqual(got, []int64{id}) {
		t.Errorf("mixed update not indexed: %v", got)
	}
}

func TestLibraryAu_UpDownUpKeepsSearchIdentical(t *testing.T) {
	conn, dir, add := previousVersionDB(t)
	seedLibrary(t, conn, 20)
	mustExec(t, conn, "UPDATE library SET title = 'renamed gamma' WHERE id = 3")
	terms := []string{"alpha1", "gamma", "upalpha5", "folderalpha7", "renamed", "nothingmatches"}
	want := searchSnapshot(t, conn, terms)
	if len(want["gamma"]) != 1 || len(want["alpha1"]) == 0 {
		t.Fatalf("seed search broken: %v", want)
	}

	add()
	check := func(step string, restricted bool) {
		t.Helper()
		if got := isRestricted(triggerSQL(t, conn, "library_au")); got != restricted {
			t.Errorf("%s: restricted = %v, want %v", step, got, restricted)
		}
		if got := searchSnapshot(t, conn, terms); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: search results changed:\n got %v\nwant %v", step, got, want)
		}
		if _, err := conn.Exec("INSERT INTO library_fts(library_fts) VALUES('integrity-check')"); err != nil {
			t.Errorf("%s: fts integrity-check: %v", step, err)
		}
		if v, d := versionRow(t, conn); d {
			t.Errorf("%s: dirty at %d", step, v)
		}
		assertHealthy(t, conn)
	}

	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	check("up", true)

	m, err := newMigrator(conn, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Steps(-1); err != nil {
		t.Fatal(err)
	}
	if v, _ := versionRow(t, conn); v != 55 {
		t.Fatalf("after down: version %d, want 55", v)
	}
	check("down", false)
	if d := updateDelta(t, conn, "UPDATE library SET playback_position_seconds = 1 WHERE id = 1"); d <= 1 {
		t.Errorf("after down the trigger should fire on any update, delta = %d", d)
	}

	if err := Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	check("up again", true)

	mustExec(t, conn, "UPDATE library SET description = 'brandnewword' WHERE id = 2")
	if got := search(t, conn, "brandnewword"); !reflect.DeepEqual(got, []int64{2}) {
		t.Errorf("post round-trip update not indexed: %v", got)
	}
}

// A failure partway through the file must leave the old trigger in place: the
// marker makes DROP TRIGGER + CREATE TRIGGER one transaction.
func TestLibraryAu_MigrationIsAtomic(t *testing.T) {
	conn, dir, _ := previousVersionDB(t)
	up, err := os.ReadFile(filepath.Join(realMigrationsDir(t), libraryAuUpFile))
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile(filepath.Join(realMigrationsDir(t), libraryAuDownFile))
	if err != nil {
		t.Fatal(err)
	}
	for name, b := range map[string][]byte{"up": up, "down": down} {
		if !strings.HasPrefix(strings.TrimSpace(string(b)), RebuildMarker) {
			t.Errorf("%s file must start with the rebuild marker", name)
		}
	}
	writeFile(t, dir, libraryAuUpFile, string(up)+"\nSELECT * FROM does_not_exist;\n")
	writeFile(t, dir, libraryAuDownFile, string(down))
	if err := Migrate(conn, dir); err == nil {
		t.Fatal("expected failure")
	}
	if v, d := versionRow(t, conn); v != 55 || d {
		t.Errorf("version %d dirty %v, want 55 clean", v, d)
	}
	if isRestricted(triggerSQL(t, conn, "library_au")) {
		t.Error("trigger changed despite the failed migration")
	}
	assertHealthy(t, conn)
}
