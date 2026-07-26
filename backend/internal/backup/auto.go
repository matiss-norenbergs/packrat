package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strconv"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

// DefaultBackupRetentionCount is how many on-disk backups RunBackup keeps
// around before pruning the oldest — a hardcoded constant rather than a
// setting, since only the backup *interval* is user-facing for now.
const DefaultBackupRetentionCount = 14

// FullBundle combines both existing export kinds into one payload for
// disk-resident auto/manual backups — the ad-hoc Export cards stay
// settings-only or library-only for users who want a partial/portable file,
// but a backup meant for disaster recovery should carry everything.
type FullBundle struct {
	Settings map[string]string `json:"settings"`
	Library  LibraryBundle     `json:"library"`
}

func BuildFullBundle(ctx context.Context, settingsRepo *repository.SettingsRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, libraryRepo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo) (FullBundle, error) {
	settings, err := BuildSettingsBundle(ctx, settingsRepo)
	if err != nil {
		return FullBundle{}, err
	}
	library, err := BuildLibraryBundle(ctx, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, downloadsRepo)
	if err != nil {
		return FullBundle{}, err
	}
	return FullBundle{Settings: settings, Library: library}, nil
}

// RunDeps bundles everything RunBackup/RunScheduledBackupIfDue need to build
// a bundle, write it to disk, and record the outcome.
type RunDeps struct {
	BackupsRoot       string
	SettingsRepo      *repository.SettingsRepo
	CollectionsRepo   *repository.CollectionsRepo
	TagsRepo          *repository.TagsRepo
	ArtistsRepo       *repository.ArtistsRepo
	LibraryRepo       *repository.LibraryRepo
	DownloadsRepo     *repository.DownloadsRepo
	BackupHistoryRepo *repository.BackupHistoryRepo
}

// RunBackup builds a full bundle, writes it (always unencrypted — an
// unattended scheduled run has nowhere to stash a password, and keeping
// manual runs consistent avoids a confusing sometimes-encrypted UX) to a
// timestamped file under deps.BackupsRoot, and records a BackupHistory row
// for the outcome. A build/write failure is still a recordable outcome, not
// a handler-level error — the returned error is non-nil only when the
// history row itself couldn't be persisted (i.e. we can't even record what
// happened).
func RunBackup(ctx context.Context, deps RunDeps, triggerType string) (models.BackupHistory, error) {
	bundle, err := BuildFullBundle(ctx, deps.SettingsRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.DownloadsRepo)
	if err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("building backup: %w", err))
	}

	plaintext, err := json.Marshal(bundle)
	if err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("encoding backup: %w", err))
	}

	env, err := Seal("full", plaintext, "")
	if err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("sealing backup: %w", err))
	}
	envJSON, err := json.Marshal(env)
	if err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("encoding backup envelope: %w", err))
	}

	// Random suffix avoids a same-second filename collision between a
	// scheduled sweep and a manual click landing in the same second.
	fileName := fmt.Sprintf("backup-%s-%04x.json", time.Now().UTC().Format("20060102-150405"), rand.Intn(0x10000))
	fullPath, err := pathsafe.ResolveUnderRoot(deps.BackupsRoot, fileName)
	if err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("resolving backup path: %w", err))
	}
	if err := os.WriteFile(fullPath, envJSON, 0o644); err != nil {
		return recordFailure(ctx, deps, triggerType, fmt.Errorf("writing backup file: %w", err))
	}

	size := int64(len(envJSON))
	libraryItemsCount := len(bundle.Library.LibraryItems)
	collectionsCount := len(bundle.Library.Collections)
	tagsCount := len(bundle.Library.Tags)
	artistsCount := len(bundle.Library.Artists)
	entry := models.BackupHistory{
		TriggerType:       triggerType,
		Status:            "success",
		FileName:          &fileName,
		FileSizeBytes:     &size,
		LibraryItemsCount: &libraryItemsCount,
		CollectionsCount:  &collectionsCount,
		TagsCount:         &tagsCount,
		ArtistsCount:      &artistsCount,
	}
	id, err := deps.BackupHistoryRepo.Create(ctx, entry)
	if err != nil {
		return models.BackupHistory{}, fmt.Errorf("recording backup history: %w", err)
	}
	entry.ID = id

	pruneOldBackups(ctx, deps)
	return entry, nil
}

// recordFailure writes a "failed" history row so the outcome stays visible
// in the Backup page's table instead of silently vanishing. It only returns
// an error itself if the row couldn't be persisted at all.
func recordFailure(ctx context.Context, deps RunDeps, triggerType string, cause error) (models.BackupHistory, error) {
	msg := cause.Error()
	entry := models.BackupHistory{TriggerType: triggerType, Status: "failed", ErrorMessage: &msg}
	id, err := deps.BackupHistoryRepo.Create(ctx, entry)
	if err != nil {
		return models.BackupHistory{}, fmt.Errorf("recording failed backup (cause: %v): %w", cause, err)
	}
	entry.ID = id
	pruneOldBackups(ctx, deps)
	return entry, nil
}

// pruneOldBackups deletes history rows (and their files) past
// DefaultBackupRetentionCount. Best-effort: logs failures rather than
// propagating them, since a pruning hiccup shouldn't fail the backup that
// just succeeded.
func pruneOldBackups(ctx context.Context, deps RunDeps) {
	pruned, err := deps.BackupHistoryRepo.DeleteExceedingRetention(ctx, DefaultBackupRetentionCount)
	if err != nil {
		log.Printf("backup retention cleanup failed: %v", err)
		return
	}
	for _, entry := range pruned {
		if entry.FileName == nil {
			continue
		}
		path, err := pathsafe.ResolveUnderRoot(deps.BackupsRoot, *entry.FileName)
		if err != nil {
			log.Printf("backup retention cleanup: resolving path for %q failed: %v", *entry.FileName, err)
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			log.Printf("backup retention cleanup: removing %q failed: %v", path, err)
		}
	}
}

// RunScheduledBackupIfDue reads the auto-backup interval directly via
// deps.SettingsRepo.Get (the raw key, not a typed api-package getter) —
// api already imports this package (backup_handler.go), so importing api
// back here would create a package cycle. 0/unset/corrupt means disabled.
// "Due" means no successful backup has ever run, or the last one is older
// than the configured interval.
func RunScheduledBackupIfDue(ctx context.Context, deps RunDeps) {
	raw, err := deps.SettingsRepo.Get(ctx, models.SettingAutoBackupIntervalHours)
	hours, convErr := strconv.Atoi(raw)
	if err != nil || convErr != nil || hours <= 0 {
		return
	}

	latest, err := deps.BackupHistoryRepo.LatestSuccessful(ctx)
	if err != nil {
		log.Printf("checking last backup time failed: %v", err)
		return
	}
	if latest != nil && time.Since(latest.CreatedAt) < time.Duration(hours)*time.Hour {
		return
	}

	if _, err := RunBackup(ctx, deps, "scheduled"); err != nil {
		log.Printf("scheduled backup failed: %v", err)
	}
}
