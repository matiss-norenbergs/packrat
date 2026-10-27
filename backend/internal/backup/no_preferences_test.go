package backup

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/repository"
)

// Per-account preferences (theme, accent) are not part of backups. Like the 2FA test, this pins
// that neither the exported bundle nor the on-disk backup file contains them.
func TestBackupsExcludeUserPreferences(t *testing.T) {
	r := openTestRepos(t)
	ctx := context.Background()
	u, err := repository.NewUsersRepo(r.db).Create(ctx, "admin", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.NewUserPreferencesRepo(r.db).Set(ctx, u.ID, map[string]string{"theme": "dark", "accent": "mono"}); err != nil {
		t.Fatal(err)
	}

	bundle, err := BuildFullBundle(ctx, r.settings, r.collections, r.tags, r.artists, r.library, r.downloads)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(bundle)

	backupsRoot := t.TempDir()
	if _, err := RunBackup(ctx, RunDeps{
		BackupsRoot: backupsRoot, SettingsRepo: r.settings, CollectionsRepo: r.collections, TagsRepo: r.tags,
		ArtistsRepo: r.artists, LibraryRepo: r.library, DownloadsRepo: r.downloads,
		BackupHistoryRepo: repository.NewBackupHistoryRepo(r.db),
	}, "manual"); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(backupsRoot, "*"))
	if len(files) == 0 {
		t.Fatal("RunBackup wrote no file")
	}
	all := string(raw)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		all += string(b)
	}
	for _, marker := range []string{"user_preferences", "accent", `"theme"`, "mono"} {
		if strings.Contains(all, marker) {
			t.Errorf("backup contains %q", marker)
		}
	}
}
