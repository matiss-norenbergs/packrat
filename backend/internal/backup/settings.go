package backup

import (
	"context"

	"packrat/backend/internal/repository"
)

// BuildSettingsBundle is just settingsRepo.GetAll() under a name that
// matches BuildLibraryBundle — kept as its own function so callers don't
// need to know GetAll() happens to already return exactly what's needed.
func BuildSettingsBundle(ctx context.Context, settingsRepo *repository.SettingsRepo) (map[string]string, error) {
	return settingsRepo.GetAll(ctx)
}

// ApplySettingsBundle overwrites every key present in bundle — same
// per-key Set() loop UpdateSettings already uses, just applied to a whole
// imported map instead of individual request fields.
func ApplySettingsBundle(ctx context.Context, settingsRepo *repository.SettingsRepo, bundle map[string]string) (applied int, err error) {
	for key, value := range bundle {
		if err := settingsRepo.Set(ctx, key, value); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}
