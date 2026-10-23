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

// Backups are built from settings and library tables only. This pins that: even with a fully
// enrolled 2FA account (secret, pending secret, recovery hashes, failure log),
// neither the exported bundles nor the on-disk backup file contain any of it.
func TestBackupsExcludeTwoFactorData(t *testing.T) {
	r := openTestRepos(t)
	ctx := context.Background()
	users := repository.NewUsersRepo(r.db)

	const secretCT, pendingCT, recoveryHash = "SECRET-CIPHERTEXT-MARKER", "PENDING-CIPHERTEXT-MARKER", "RECOVERY-HASH-MARKER"
	u, err := users.Create(ctx, "admin", "bcrypt-hash-marker")
	if err != nil {
		t.Fatal(err)
	}
	if err := users.EnableTOTP(ctx, u.ID, secretCT, 1, []string{recoveryHash}); err != nil {
		t.Fatal(err)
	}
	if err := users.SetPendingTOTP(ctx, u.ID, pendingCT); err != nil {
		t.Fatal(err)
	}
	if err := users.RecordLoginFailure(ctx, "203.0.113.5", "code", u.CreatedAt, 24*60*60*1e9); err != nil {
		t.Fatal(err)
	}

	bundle, err := BuildFullBundle(ctx, r.settings, r.collections, r.tags, r.artists, r.library, r.downloads)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(bundle)

	backupsRoot := t.TempDir()
	hist := repository.NewBackupHistoryRepo(r.db)
	if _, err := RunBackup(ctx, RunDeps{
		BackupsRoot: backupsRoot, SettingsRepo: r.settings, CollectionsRepo: r.collections, TagsRepo: r.tags,
		ArtistsRepo: r.artists, LibraryRepo: r.library, DownloadsRepo: r.downloads, BackupHistoryRepo: hist,
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
	for _, marker := range []string{secretCT, pendingCT, recoveryHash, "bcrypt-hash-marker", "203.0.113.5", "totp", "recovery"} {
		if strings.Contains(all, marker) {
			t.Errorf("backup contains %q", marker)
		}
	}
}
