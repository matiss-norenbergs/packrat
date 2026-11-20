package backup

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"strconv"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// BuildSettingsBundle is just settingsRepo.GetAll() under a name that
// matches BuildLibraryBundle — kept as its own function so callers don't
// need to know GetAll() happens to already return exactly what's needed.
func BuildSettingsBundle(ctx context.Context, settingsRepo *repository.SettingsRepo) (map[string]string, error) {
	return settingsRepo.GetAll(ctx)
}

// retiredSettingKeys are settings that no longer exist. Old backups and settings
// files still contain them, and restoring one must not bring the row back.
var retiredSettingKeys = map[string]bool{
	"library_sort": true, // now the account's saved `library` table layout
}

// What an adjustment did to a value of the bundle.
const (
	AdjustClamped = "clamped" // a number above its limit was lowered to the limit
	AdjustSkipped = "skipped" // the bundle's value was not applied; the stored value stays
	AdjustDropped = "dropped" // unknown entries of a list were removed, the rest applied
)

// Why a value was adjusted (fixed texts: never anything taken from the file).
const (
	ReasonAboveLimit   = "above the limit"
	ReasonOutOfRange   = "outside the allowed range"
	ReasonUnknownValue = "unknown value"
	ReasonUnknownItems = "unknown entries"
	ReasonPairInverted = "low is not below high"
)

// SettingAdjustment is one value a restore changed or left out instead of
// writing it verbatim. From/To are numbers only (set for a clamp); the unknown
// text of an enum or widget value is never recorded.
type SettingAdjustment struct {
	Key    string
	Action string
	Reason string
	From   *int
	To     *int
}

// SettingsApplyResult is what ApplySettingsBundle did.
type SettingsApplyResult struct {
	// Applied is the number of values actually written.
	Applied int
	// Written is exactly what was stored (clamped values included): use it, not
	// the raw bundle, for anything derived from the stored settings.
	Written map[string]string
	// Adjustments lists every clamped / skipped / dropped value (nil if none).
	Adjustments []SettingAdjustment
}

// ApplySettingsBundle overwrites the keys present in bundle in ONE transaction
// (SettingsRepo.SetMany): all of it is written or none of it, so a failure can't
// leave a partial mix. Retired keys are skipped and not counted. The shared
// rules in models (settings_rules.go — the same ones PATCH /api/settings
// enforces) are applied without ever failing the restore: a number above its
// limit is clamped; an unknown fixed-list value or an inverted low/high pair is
// not applied (the stored value stays); unknown Dashboard widget names are
// dropped. Each adjustment is logged and returned. Other values, garbage
// included, are written verbatim (the getters fall back to defaults).
func ApplySettingsBundle(ctx context.Context, settingsRepo *repository.SettingsRepo, bundle map[string]string) (SettingsApplyResult, error) {
	values := make(map[string]string, len(bundle))
	for key, value := range bundle {
		if retiredSettingKeys[key] {
			continue
		}
		values[key] = value
	}

	var adj []SettingAdjustment
	note := func(a SettingAdjustment) {
		adj = append(adj, a)
		if a.From != nil && a.To != nil {
			log.Printf("backup: settings restore: %s %s (%s): %d -> %d", a.Key, a.Action, a.Reason, *a.From, *a.To)
		} else {
			log.Printf("backup: settings restore: %s %s (%s)", a.Key, a.Action, a.Reason)
		}
	}

	// Iterate in key order so the adjustment list (and the log) is stable.
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		value := values[key]
		// Caps: clamp. A value that is not a number is left for the getters.
		if max, ok := models.SettingMaxValue(key); ok {
			if n, err := strconv.Atoi(value); err == nil && n > max {
				values[key] = strconv.Itoa(max)
				from, to := n, max
				note(SettingAdjustment{Key: key, Action: AdjustClamped, Reason: ReasonAboveLimit, From: &from, To: &to})
			}
		}
		// Ranges (lower and upper bound): clamp into the range.
		if r, ok := models.SettingRange(key); ok {
			if n, err := strconv.Atoi(value); err == nil && r.Clamp(n) != n {
				to := r.Clamp(n)
				values[key] = strconv.Itoa(to)
				from := n
				note(SettingAdjustment{Key: key, Action: AdjustClamped, Reason: ReasonOutOfRange, From: &from, To: &to})
			}
		}
		// Fixed lists: skip an unknown value.
		if !models.ValidSettingEnum(key, value) {
			delete(values, key)
			note(SettingAdjustment{Key: key, Action: AdjustSkipped, Reason: ReasonUnknownValue})
		}
		// Dashboard widgets: drop unknown names, keep the rest. Text that is not
		// a JSON string list is written as is (the reader treats it as empty).
		if key == models.SettingDashboardHiddenWidgets {
			var ids []string
			if err := json.Unmarshal([]byte(value), &ids); err == nil {
				if valid, unknown := models.NormalizeDashboardWidgetIDs(ids); len(unknown) > 0 {
					encoded, err := json.Marshal(valid)
					if err != nil {
						return SettingsApplyResult{}, err
					}
					values[key] = string(encoded)
					note(SettingAdjustment{Key: key, Action: AdjustDropped, Reason: ReasonUnknownItems})
				}
			}
		}
	}

	// Pairs: evaluate the effective pair like PATCH does (the stored value for a
	// side the bundle doesn't carry) and skip the bundle's side(s) if inverted.
	for _, pair := range models.SettingPairs {
		lowRaw, hasLow := values[pair.LowKey]
		highRaw, hasHigh := values[pair.HighKey]
		if !hasLow && !hasHigh {
			continue
		}
		side := func(key, raw string, inBundle bool, def int) (int, error) {
			if inBundle {
				return pair.EffectiveValue(raw, true, def), nil
			}
			stored, err := settingsRepo.Get(ctx, key)
			if errors.Is(err, repository.ErrNotFound) {
				return def, nil
			}
			if err != nil {
				return 0, err
			}
			return pair.EffectiveValue(stored, true, def), nil
		}
		low, err := side(pair.LowKey, lowRaw, hasLow, pair.LowDefault)
		if err != nil {
			return SettingsApplyResult{}, err
		}
		high, err := side(pair.HighKey, highRaw, hasHigh, pair.HighDefault)
		if err != nil {
			return SettingsApplyResult{}, err
		}
		if models.PairValid(low, high) {
			continue
		}
		for _, key := range []string{pair.LowKey, pair.HighKey} {
			if _, ok := values[key]; ok {
				delete(values, key)
				note(SettingAdjustment{Key: key, Action: AdjustSkipped, Reason: ReasonPairInverted})
			}
		}
	}

	if err := settingsRepo.SetMany(ctx, values); err != nil {
		return SettingsApplyResult{}, err
	}
	return SettingsApplyResult{Applied: len(values), Written: values, Adjustments: adj}, nil
}
