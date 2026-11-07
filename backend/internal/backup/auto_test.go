package backup

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func newRunDeps(t *testing.T, root string, retention int) RunDeps {
	t.Helper()
	repos := openTestRepos(t)
	if err := repos.settings.Set(context.Background(), models.SettingBackupRetentionCount, strconv.Itoa(retention)); err != nil {
		t.Fatal(err)
	}
	return RunDeps{
		BackupsRoot:       root,
		SettingsRepo:      repos.settings,
		CollectionsRepo:   repos.collections,
		TagsRepo:          repos.tags,
		ArtistsRepo:       repos.artists,
		LibraryRepo:       repos.library,
		DownloadsRepo:     repos.downloads,
		BackupHistoryRepo: repository.NewBackupHistoryRepo(repos.db),
	}
}

func countByStatus(t *testing.T, deps RunDeps) (success, failed int) {
	t.Helper()
	all, err := deps.BackupHistoryRepo.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range all {
		if e.Status == "success" {
			success++
		} else {
			failed++
		}
	}
	return
}

func filesIn(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}

func TestRunBackup_FailuresNeverDeleteSuccesses(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	deps := newRunDeps(t, root, 14)

	for i := 0; i < 14; i++ {
		if e, err := RunBackup(ctx, deps, "scheduled"); err != nil || e.Status != "success" {
			t.Fatalf("setup backup %d: %+v %v", i, e, err)
		}
	}
	if s, _ := countByStatus(t, deps); s != 14 || filesIn(t, root) != 14 {
		t.Fatalf("setup: %d success rows, %d files", s, filesIn(t, root))
	}

	// Break the backups root so every run fails at the write step.
	deps.BackupsRoot = filepath.Join(root, "missing")
	for i := 0; i < 30; i++ {
		e, err := RunBackup(ctx, deps, "scheduled")
		if err != nil || e.Status != "failed" {
			t.Fatalf("failing run %d: %+v %v", i, e, err)
		}
	}
	s, f := countByStatus(t, deps)
	if s != 14 || f != MaxFailedBackupRows {
		t.Fatalf("after failures: %d success, %d failed; want 14 and %d", s, f, MaxFailedBackupRows)
	}
	if n := filesIn(t, root); n != 14 {
		t.Fatalf("%d files on disk, want 14", n)
	}
}

func TestRunBackup_SuccessAfterFailuresPrunesSuccesses(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	deps := newRunDeps(t, root, 3)

	for i := 0; i < 3; i++ {
		if _, err := RunBackup(ctx, deps, "scheduled"); err != nil {
			t.Fatal(err)
		}
	}
	good := deps.BackupsRoot
	deps.BackupsRoot = filepath.Join(root, "missing")
	for i := 0; i < 25; i++ {
		RunBackup(ctx, deps, "scheduled")
	}
	deps.BackupsRoot = good
	if e, err := RunBackup(ctx, deps, "scheduled"); err != nil || e.Status != "success" {
		t.Fatalf("recovery run: %+v %v", e, err)
	}
	s, f := countByStatus(t, deps)
	if s != 3 || f != MaxFailedBackupRows {
		t.Fatalf("got %d success, %d failed; want 3 and %d", s, f, MaxFailedBackupRows)
	}
	if n := filesIn(t, root); n != 3 {
		t.Fatalf("%d files on disk, want 3", n)
	}
}

func TestRunBackup_UnlimitedStillCapsFailed(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	deps := newRunDeps(t, root, 0)
	for i := 0; i < 5; i++ {
		if _, err := RunBackup(ctx, deps, "scheduled"); err != nil {
			t.Fatal(err)
		}
	}
	deps.BackupsRoot = filepath.Join(root, "missing")
	for i := 0; i < 30; i++ {
		RunBackup(ctx, deps, "scheduled")
	}
	s, f := countByStatus(t, deps)
	if s != 5 || f != MaxFailedBackupRows || filesIn(t, root) != 5 {
		t.Fatalf("got %d success, %d failed, %d files", s, f, filesIn(t, root))
	}
}

func TestRunBackup_FileIsOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not meaningful on Windows")
	}
	root := t.TempDir()
	deps := newRunDeps(t, root, 14)
	e, err := RunBackup(context.Background(), deps, "manual")
	if err != nil || e.Status != "success" {
		t.Fatalf("backup: %v %+v", err, e)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Fatalf("expected 1 file, got %d", len(entries))
	}
	info, err := entries[0].Info()
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("backup mode = %o, want 600", mode)
	}
}

// The pre-migration safety copies live in BackupsRoot/pre-migration. Backups are listed and
// pruned from history rows, never by scanning the directory, so that folder must be left alone
// by retention even when it is far over the Backup tab limit.
func TestRunBackup_IgnoresPreMigrationFolder(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	deps := newRunDeps(t, root, 1)

	pre := filepath.Join(root, "pre-migration")
	if err := os.MkdirAll(pre, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		name := "packrat-pre-migration-v" + strconv.Itoa(i) + "-to-v" + strconv.Itoa(i+1) + ".db"
		if err := os.WriteFile(filepath.Join(pre, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < 3; i++ {
		if e, err := RunBackup(ctx, deps, "manual"); err != nil || e.Status != "success" {
			t.Fatalf("backup %d: %+v %v", i, e, err)
		}
	}
	if s, f := countByStatus(t, deps); s != 1 || f != 0 {
		t.Fatalf("history has %d success, %d failed; want 1 and 0", s, f)
	}
	if n := filesIn(t, pre); n != 5 {
		t.Fatalf("retention touched the pre-migration folder: %d files left, want 5", n)
	}
	if n := filesIn(t, root); n != 2 { // the one kept backup + the pre-migration folder
		t.Fatalf("%d entries in the backups root, want 2", n)
	}
}
