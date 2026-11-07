package backup

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

// eventDeps is newRunDeps plus a recorder writing to the same database.
func eventDeps(t *testing.T, root string) (RunDeps, *repository.SystemEventsRepo) {
	t.Helper()
	repos := openTestRepos(t)
	events := repository.NewSystemEventsRepo(repos.db)
	deps := RunDeps{
		BackupsRoot:       root,
		SettingsRepo:      repos.settings,
		CollectionsRepo:   repos.collections,
		TagsRepo:          repos.tags,
		ArtistsRepo:       repos.artists,
		LibraryRepo:       repos.library,
		DownloadsRepo:     repos.downloads,
		BackupHistoryRepo: repository.NewBackupHistoryRepo(repos.db),
		Events:            sysevents.New(events, repos.settings),
	}
	if err := repos.settings.Set(context.Background(), models.SettingAutoBackupIntervalHours, strconv.Itoa(6)); err != nil {
		t.Fatal(err)
	}
	return deps, events
}

// A scheduled backup that fails is recorded as an error; one that works records nothing.
func TestScheduledBackupFailureIsRecorded(t *testing.T) {
	ctx := context.Background()

	good, goodEvents := eventDeps(t, t.TempDir())
	RunScheduledBackupIfDue(ctx, good)
	if _, total, _ := goodEvents.Query(ctx, repository.SystemEventQuery{}); total != 0 {
		t.Fatalf("a successful backup recorded %d events", total)
	}

	// The backups folder is a regular file, so the backup cannot be written.
	blocker := filepath.Join(t.TempDir(), "not-a-folder")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	bad, badEvents := eventDeps(t, filepath.Join(blocker, "backups"))
	RunScheduledBackupIfDue(ctx, bad)
	items, total, err := badEvents.Query(ctx, repository.SystemEventQuery{})
	if err != nil || total != 1 {
		t.Fatalf("got %d events (%v)", total, err)
	}
	if items[0].Level != "error" || items[0].Category != "backup" || items[0].Message != "Scheduled backup failed" {
		t.Fatalf("%+v", items[0])
	}
}
