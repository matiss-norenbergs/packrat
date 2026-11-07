package db

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/golang-migrate/migrate/v4/database"
)

// RebuildMarker is the exact first non-empty line of a migration file that
// rebuilds a table (CREATE X_new, copy, DROP TABLE X, rename). The runner
// executes such files transactionally with foreign keys off; see
// database/migrations/README.md for the rules a marked file must follow.
const RebuildMarker = "-- packrat:rebuild"

// rebuildDriver wraps the sqlite driver (opened with NoTxWrap) and runs
// marked rebuild migrations atomically. Unmarked files go to the wrapped
// driver untouched.
type rebuildDriver struct {
	database.Driver
	db *sql.DB
	// prev is the clean version recorded before golang-migrate set the
	// in-flight (dirty) version; a failed rebuild is rolled back to it.
	prev int
}

func (d *rebuildDriver) SetVersion(version int, dirty bool) error {
	if dirty {
		// golang-migrate marks the target version dirty right before Run.
		// At that point the stored version is still the clean previous one.
		v, _, err := d.Driver.Version()
		if err != nil {
			return err
		}
		d.prev = v
	}
	return d.Driver.SetVersion(version, dirty)
}

func (d *rebuildDriver) Run(migration io.Reader) error {
	body, err := io.ReadAll(migration)
	if err != nil {
		return err
	}
	if !isRebuildBody(string(body)) {
		return d.Driver.Run(bytes.NewReader(body))
	}

	err = validateRebuildBody(string(body))
	if err == nil {
		err = d.execRebuild(context.Background(), string(body))
	}
	if err == nil {
		return nil
	}
	// The whole file was rolled back (or never started), so the schema is
	// exactly at the previous version: clear the dirty flag so a retry works.
	if herr := d.Driver.SetVersion(d.prev, false); herr != nil {
		err = errors.Join(err, fmt.Errorf("resetting migration version to %d: %w", d.prev, herr))
	}
	return err
}

// execRebuild runs body on one pinned connection:
// foreign_keys OFF, BEGIN, body, foreign_key_check, COMMIT, foreign_keys ON.
func (d *rebuildDriver) execRebuild(ctx context.Context, body string) (err error) {
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("pinning connection: %w", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return fmt.Errorf("disabling foreign keys: %w", err)
	}
	// Always put foreign keys back, on every path, before the connection
	// returns to the pool.
	defer func() {
		if _, ferr := conn.ExecContext(context.Background(), "PRAGMA foreign_keys = ON"); ferr != nil {
			err = errors.Join(err, fmt.Errorf("re-enabling foreign keys: %w", ferr))
		}
	}()

	if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	inTx := true
	defer func() {
		if inTx {
			if _, rerr := conn.ExecContext(context.Background(), "ROLLBACK"); rerr != nil {
				err = errors.Join(err, fmt.Errorf("rollback: %w", rerr))
			}
		}
	}()

	if _, err := conn.ExecContext(ctx, body); err != nil {
		return fmt.Errorf("rebuild migration failed (rolled back): %w", err)
	}

	tables, err := foreignKeyViolations(ctx, conn)
	if err != nil {
		return err
	}
	if len(tables) > 0 {
		return fmt.Errorf("rebuild migration left foreign key violations in: %s (rolled back)", strings.Join(tables, ", "))
	}

	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	inTx = false
	return nil
}

// foreignKeyViolations returns the distinct tables PRAGMA foreign_key_check
// reports rows for. The SQL-level check cannot fail a migration by itself.
func foreignKeyViolations(ctx context.Context, conn *sql.Conn) ([]string, error) {
	rows, err := conn.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return nil, fmt.Errorf("foreign_key_check: %w", err)
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var tables []string
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		name := fmt.Sprint(vals[0]) // column 0 is the child table
		if b, ok := vals[0].([]byte); ok {
			name = string(b)
		}
		if !seen[name] {
			seen[name] = true
			tables = append(tables, name)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(tables)
	return tables, nil
}

// isRebuildBody reports whether the first non-empty line is exactly the marker.
func isRebuildBody(body string) bool {
	body = strings.TrimPrefix(body, "\xef\xbb\xbf")
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return line == RebuildMarker
	}
	return false
}

func isRebuildFile(path string) bool {
	b, err := os.ReadFile(path)
	return err == nil && isRebuildBody(string(b))
}

var (
	reTrigger     = regexp.MustCompile(`(?i)^create\s+(temp\s+|temporary\s+)?trigger\b`)
	reTxStmt      = regexp.MustCompile(`(?i)^(begin|commit|end|rollback|savepoint|release)\b`)
	reFKPragma    = regexp.MustCompile(`(?i)^pragma\s+(\w+\s*\.\s*)?foreign_keys\b`)
	reTrailingEnd = regexp.MustCompile(`(?i)\bend\s*$`)
)

// validateRebuildBody rejects transaction control and foreign_keys PRAGMAs:
// the runner owns both. Trigger bodies legitimately contain BEGIN/END, so
// statements are split with CREATE TRIGGER kept whole.
func validateRebuildBody(body string) error {
	var cur strings.Builder
	inTrigger := false
	for _, part := range strings.Split(stripSQLNoise(body), ";") {
		cur.WriteString(part)
		stmt := strings.TrimSpace(cur.String())
		if stmt == "" {
			cur.Reset()
			continue
		}
		if !inTrigger && reTrigger.MatchString(stmt) {
			inTrigger = true
		}
		if inTrigger && !reTrailingEnd.MatchString(stmt) {
			cur.WriteString(";")
			continue
		}
		inTrigger = false
		cur.Reset()
		if reTxStmt.MatchString(stmt) {
			return fmt.Errorf("rebuild migration must not contain %s: the runner wraps it in a transaction", firstWord(stmt))
		}
		if reFKPragma.MatchString(stmt) {
			return errors.New("rebuild migration must not set PRAGMA foreign_keys: the runner turns it off and on around the transaction")
		}
	}
	return nil
}

func firstWord(s string) string {
	if f := strings.Fields(s); len(f) > 0 {
		return strings.ToUpper(f[0])
	}
	return s
}

// stripSQLNoise removes comments and replaces string literals with ” so
// splitting on ';' and keyword checks cannot be fooled by their contents.
func stripSQLNoise(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch {
		case strings.HasPrefix(s[i:], "--"):
			for i < len(s) && s[i] != '\n' {
				i++
			}
			b.WriteByte('\n')
		case strings.HasPrefix(s[i:], "/*"):
			end := strings.Index(s[i+2:], "*/")
			if end < 0 {
				i = len(s)
			} else {
				i += end + 3
			}
			b.WriteByte(' ')
		case s[i] == '\'' || s[i] == '"':
			q := s[i]
			i++
			for i < len(s) {
				if s[i] == q {
					if i+1 < len(s) && s[i+1] == q {
						i += 2
						continue
					}
					break
				}
				i++
			}
			b.WriteString("''")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

var reUpFile = regexp.MustCompile(`^(\d+)_.*\.up\.sql$`)

// upMigrations maps version -> file path for the .up.sql files in dir.
func upMigrations(dir string) (map[int]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := map[int]string{}
	for _, e := range entries {
		if m := reUpFile.FindStringSubmatch(e.Name()); m != nil {
			v, _ := strconv.Atoi(m[1])
			out[v] = filepath.Join(dir, e.Name())
		}
	}
	return out, nil
}

// DirtyError is returned when the migration table is dirty at a version that
// is not a marked rebuild migration. It is never auto-repaired.
type DirtyError struct{ Version int }

func (e *DirtyError) Error() string {
	return fmt.Sprintf("database is dirty at migration version %d: an earlier migration did not finish, "+
		"so the schema may be half-applied. The server will not start until this is fixed. "+
		"Restore the database from a backup (the database lives in the data/db folder, "+
		"backups are in the data/backups folder) and start again", e.Version)
}
