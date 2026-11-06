package repository

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/db"
)

func openMigratedConn(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return conn
}

// SQLite does not index the child side of a foreign key, so deleting a parent
// row scans every child table once per deleted row. This keeps future
// migrations from reintroducing that.
func TestEveryForeignKeyChildColumnIsIndexed(t *testing.T) {
	conn := openMigratedConn(t)

	tableRows, err := conn.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for tableRows.Next() {
		var n string
		if err := tableRows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, n)
	}
	tableRows.Close()

	for _, table := range tables {
		// Leading columns of every index (including the implicit PK and UNIQUE ones).
		leading := map[string]bool{}
		var pkCols []string
		cols, err := conn.Query(`SELECT name, pk FROM pragma_table_info(?)`, table)
		if err != nil {
			t.Fatal(err)
		}
		for cols.Next() {
			var name string
			var pk int
			if err := cols.Scan(&name, &pk); err != nil {
				t.Fatal(err)
			}
			if pk == 1 {
				pkCols = append(pkCols, name)
			}
		}
		cols.Close()
		// A single-column INTEGER PRIMARY KEY is the rowid; a composite PK has an
		// autoindex whose leading column is its first pk column (pk == 1).
		for _, c := range pkCols {
			leading[c] = true
		}

		idxs, err := conn.Query(`SELECT name FROM pragma_index_list(?)`, table)
		if err != nil {
			t.Fatal(err)
		}
		var idxNames []string
		for idxs.Next() {
			var n string
			if err := idxs.Scan(&n); err != nil {
				t.Fatal(err)
			}
			idxNames = append(idxNames, n)
		}
		idxs.Close()
		for _, idx := range idxNames {
			var first string
			if err := conn.QueryRow(`SELECT name FROM pragma_index_info(?) WHERE seqno = 0`, idx).Scan(&first); err != nil {
				t.Fatal(err)
			}
			leading[first] = true
		}

		fks, err := conn.Query(`SELECT "from", "table" FROM pragma_foreign_key_list(?)`, table)
		if err != nil {
			t.Fatal(err)
		}
		for fks.Next() {
			var from, parent string
			if err := fks.Scan(&from, &parent); err != nil {
				t.Fatal(err)
			}
			if !leading[from] {
				t.Errorf("foreign key %s.%s -> %s has no index with %s as its leading column", table, from, parent, from)
			}
		}
		fks.Close()
	}
}

func TestParentDeletesDoNotScanChildTables(t *testing.T) {
	conn := openMigratedConn(t)
	for _, table := range []string{"downloads", "library", "tags", "artists", "collections"} {
		rows, err := conn.Query("EXPLAIN QUERY PLAN DELETE FROM "+table+" WHERE id = ?", 1)
		if err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		for rows.Next() {
			var id, parent, notused int
			var detail string
			if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(detail, "SCAN") {
				t.Errorf("DELETE FROM %s: plan scans: %s", table, detail)
			}
		}
		rows.Close()
	}
}
