// Package features reads the optional-feature toggles (Settings → Features).
// A feature that is off is hidden in the UI, rejected by the API and idle in
// the background, but none of its data is touched, so turning it back on
// restores everything.
package features

import (
	"context"
	"strconv"

	"packrat/backend/internal/repository"
)

// Enabled reports whether the feature behind key (one of the
// models.SettingFeature* constants) is on. It defaults to true when the
// setting was never written, and also when it can't be read or parsed —
// a transient DB error must not switch a feature off.
func Enabled(ctx context.Context, repo *repository.SettingsRepo, key string) bool {
	if repo == nil {
		return true
	}
	raw, err := repo.Get(ctx, key)
	if err != nil {
		return true
	}
	on, err := strconv.ParseBool(raw)
	if err != nil {
		return true
	}
	return on
}
