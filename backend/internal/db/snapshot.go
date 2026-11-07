package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
)

const (
	// PreMigrationDirName is the subfolder of BACKUPS_ROOT that holds the
	// automatic pre-migration copies. The Backup tab never reads it: backups
	// are listed from history rows and only files named by a row are touched.
	PreMigrationDirName = "pre-migration"

	// PreMigrationKeep is how many pre-migration copies are kept (newest by
	// modification time). Pruning is by count only.
	PreMigrationKeep = 5

	preMigrationTmpPrefix = ".packrat-pre-migration-"
	preMigrationTmpSuffix = ".tmp"
)

// preMigrationName matches exactly the files this package creates and prunes.
var preMigrationName = regexp.MustCompile(`^packrat-pre-migration-v\d+-to-v\d+\.db$`)

// SnapshotError is returned when the safety copy could not be made. No
// migration has been applied when it is returned.
type SnapshotError struct {
	Dir   string
	Cause error
}

func (e *SnapshotError) Error() string {
	return fmt.Sprintf("could not make the pre-migration safety copy of the database in %q: %v. "+
		"No migration was applied and the database was not changed, so the previous version can still be run. "+
		"Likely causes: not enough free disk space, or the backups folder is not writable by the server. "+
		"Fix that and start again, or set SKIP_PRE_MIGRATION_BACKUP=true to apply the migrations without a safety copy",
		e.Dir, e.Cause)
}

func (e *SnapshotError) Unwrap() error { return e.Cause }

// MigrationResult reports what MigrateWithSnapshot did. A migration that fails is not reported
// here: it returns an error and, since the system log lives in the database being migrated, the
// failure stays in stdout only.
type MigrationResult struct {
	// Applied is true when the schema version went up (including a brand-new database).
	Applied bool
	// From is the version before (0 for a new database), To the version after.
	From, To int
	// Duration is how long applying the migrations took (the safety copy is not included).
	Duration time.Duration
	// SnapshotPath and SnapshotSize describe the pre-migration copy, empty/0 when none was made
	// (new install, nothing pending, or SKIP_PRE_MIGRATION_BACKUP).
	SnapshotPath string
	SnapshotSize int64
}

// MigrateWithSnapshot is Migrate preceded by a safety copy of the database.
//
//  1. If the database has no migration applied yet (new install), is dirty, or
//     has nothing pending, it just calls Migrate.
//  2. Otherwise it writes <snapshotDir>/packrat-pre-migration-v<from>-to-v<to>.db
//     (VACUUM INTO, so rows still in the WAL are included) and only then runs
//     Migrate. If the copy fails, Migrate is not run and a *SnapshotError is
//     returned. skip=true (SKIP_PRE_MIGRATION_BACKUP) skips the copy with a warning.
//  3. After a successful Migrate it prunes copies beyond PreMigrationKeep. A
//     failed Migrate prunes nothing.
func MigrateWithSnapshot(conn *sql.DB, migrationsDir, snapshotDir string, skip bool) (MigrationResult, error) {
	started := time.Now()
	from, dirty, applied, err := currentVersion(conn)
	if err != nil {
		return MigrationResult{}, err
	}
	res := MigrationResult{From: from}
	// finish runs Migrate (the part that can fail) and fills in the outcome.
	finish := func() (MigrationResult, error) {
		if err := Migrate(conn, migrationsDir); err != nil {
			return res, err
		}
		to, _, _, err := currentVersion(conn)
		if err != nil {
			return res, err
		}
		res.To = to
		res.Applied = to > res.From
		res.Duration = time.Since(started)
		return res, nil
	}
	if !applied || dirty {
		return finish()
	}
	ups, err := upMigrations(migrationsDir)
	if err != nil {
		return res, fmt.Errorf("reading migrations: %w", err)
	}
	to := from
	for v := range ups {
		if v > to {
			to = v
		}
	}
	if to <= from {
		return finish()
	}

	if skip {
		log.Printf("WARNING: SKIP_PRE_MIGRATION_BACKUP is set: applying migrations v%d -> v%d without a safety copy of the database", from, to)
		return finish()
	}

	path, size, err := writePreMigrationCopy(conn, snapshotDir, from, to)
	if err != nil {
		return res, &SnapshotError{Dir: snapshotDir, Cause: err}
	}
	res.SnapshotPath, res.SnapshotSize = path, size
	log.Printf("pre-migration safety copy written: %s (%d bytes)", path, size)

	// Duration covers the migrations only, not the safety copy.
	started = time.Now()
	out, err := finish()
	if err != nil {
		return out, err
	}
	if n, err := prunePreMigrationCopies(snapshotDir, PreMigrationKeep); err != nil {
		log.Printf("pre-migration copy cleanup failed: %v", err)
	} else if n > 0 {
		log.Printf("pruned %d old pre-migration copies (keeping the newest %d)", n, PreMigrationKeep)
	}
	return out, nil
}

// currentVersion reads golang-migrate's bookkeeping. applied is false when
// the table is missing or empty (a brand-new database).
func currentVersion(conn *sql.DB) (version int, dirty, applied bool, err error) {
	var n int
	if err = conn.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&n); err != nil {
		return 0, false, false, fmt.Errorf("reading migration version: %w", err)
	}
	if n == 0 {
		return 0, false, false, nil
	}
	err = conn.QueryRow(`SELECT version, dirty FROM schema_migrations LIMIT 1`).Scan(&version, &dirty)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, false, nil
	}
	if err != nil {
		return 0, false, false, fmt.Errorf("reading migration version: %w", err)
	}
	return version, dirty, true, nil
}

func writePreMigrationCopy(conn *sql.DB, dir string, from, to int) (path string, size int64, err error) {
	if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", 0, fmt.Errorf("creating folder: %w", err)
		}
	} else if statErr != nil {
		return "", 0, statErr
	}

	ctx := context.Background()
	var pages, pageSize int64
	if err := conn.QueryRowContext(ctx, `PRAGMA page_count`).Scan(&pages); err != nil {
		return "", 0, fmt.Errorf("measuring database: %w", err)
	}
	if err := conn.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&pageSize); err != nil {
		return "", 0, fmt.Errorf("measuring database: %w", err)
	}
	// Best effort: if the free space cannot be read, rely on VACUUM INTO's own error.
	if need := uint64(pages * pageSize); need > 0 {
		if u, uerr := disk.Usage(dir); uerr == nil && u.Free < need {
			return "", 0, fmt.Errorf("not enough free disk space (%d bytes free, about %d needed)", u.Free, need)
		}
	}

	removeStaleTmp(dir)

	tmp, err := os.CreateTemp(dir, preMigrationTmpPrefix+"*"+preMigrationTmpSuffix)
	if err != nil {
		return "", 0, fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close() // VACUUM INTO accepts an existing empty file
	done := false
	defer func() {
		if !done {
			os.Remove(tmpPath)
		}
	}()

	quoted := strings.ReplaceAll(filepath.ToSlash(tmpPath), "'", "''")
	if _, err := conn.ExecContext(ctx, "VACUUM INTO '"+quoted+"'"); err != nil {
		return "", 0, fmt.Errorf("copying database: %w", err)
	}

	f, err := os.OpenFile(tmpPath, os.O_RDWR, 0o600)
	if err != nil {
		return "", 0, err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return "", 0, fmt.Errorf("flushing copy: %w", err)
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return "", 0, err
	}
	if err := f.Close(); err != nil {
		return "", 0, err
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		return "", 0, err
	}

	final := filepath.Join(dir, fmt.Sprintf("packrat-pre-migration-v%d-to-v%d.db", from, to))
	if err := os.Rename(tmpPath, final); err != nil {
		return "", 0, fmt.Errorf("moving copy into place: %w", err)
	}
	done = true
	syncDir(dir)
	return final, st.Size(), nil
}

// removeStaleTmp deletes temp files a crashed earlier run left behind.
func removeStaleTmp(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		n := e.Name()
		if !e.IsDir() && strings.HasPrefix(n, preMigrationTmpPrefix) && strings.HasSuffix(n, preMigrationTmpSuffix) {
			os.Remove(filepath.Join(dir, n))
		}
	}
}

// prunePreMigrationCopies deletes all but the newest keep files whose name
// matches preMigrationName. Nothing else in dir is touched.
func prunePreMigrationCopies(dir string, keep int) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	type cand struct {
		name string
		mod  int64
	}
	var cands []cand
	for _, e := range entries {
		if !preMigrationName.MatchString(e.Name()) || !e.Type().IsRegular() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		cands = append(cands, cand{e.Name(), info.ModTime().UnixNano()})
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].mod != cands[j].mod {
			return cands[i].mod > cands[j].mod
		}
		return cands[i].name > cands[j].name
	})
	removed := 0
	var firstErr error
	for i := keep; i < len(cands); i++ {
		if err := os.Remove(filepath.Join(dir, cands[i].name)); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		removed++
	}
	return removed, firstErr
}

// SchemaVersion returns the current migration version (0 for a brand-new database).
func SchemaVersion(conn *sql.DB) (int, error) {
	v, _, _, err := currentVersion(conn)
	return v, err
}
