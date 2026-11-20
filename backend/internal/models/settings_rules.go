package models

import (
	"sort"
	"strconv"
)

// Shared settings validation rules. PATCH /api/settings and the settings
// import / full restore (backup.ApplySettingsBundle) MUST both go through
// these, so they cannot drift apart: PATCH rejects a violation with 400, a
// restore (which must never fail halfway) clamps or skips it instead.
//
// Plain data plus pure functions only — no database, no HTTP — so they are
// trivially unit-testable and importable from both api and backup.

// Limits for numeric settings where a huge but otherwise valid number does
// real harm. All are well above anything the Settings UI offers (the UI never
// sends more than the largest preset or select option below). The downloads
// limit lives next to these in limits.go.
const (
	// MaxConcurrentTranscodesLimit bounds simultaneous ffmpeg re-encodes (one
	// process each) for trim previews.
	MaxConcurrentTranscodesLimit = 16
	// MaxThumbnailFrameCount is also the largest "count" the candidate-frame
	// endpoint accepts, so a larger stored value would make every
	// "Choose from Video" request fail. The UI offers up to 24.
	MaxThumbnailFrameCount = 50
	// MaxThumbnailEnhancementFactor is the upscale multiplier requested from
	// the external Stable Diffusion WebUI; a huge one asks it for an enormous
	// image. The UI presets are 2-4.
	MaxThumbnailEnhancementFactor = 16
	// MaxThumbnailEnhancementTargetDim is the target longest side in pixels in
	// "resolution" mode (it becomes a multiplier sent to the same service).
	// The UI presets go up to 3840.
	MaxThumbnailEnhancementTargetDim = 16384
	// MaxYtdlpRetries is passed to yt-dlp as --retries/--fragment-retries; a
	// huge value makes a failing download retry (and hang) practically forever.
	// yt-dlp's own default is 10.
	MaxYtdlpRetries = 100
	// MaxDownloadTimeoutMinutes (10 years) keeps time.Duration(n)*time.Minute
	// from overflowing int64 (about 153 million minutes), which would turn the
	// timeout negative and cancel every download immediately.
	MaxDownloadTimeoutMinutes = 5_256_000
	// MaxRetentionDays (100 years) keeps the history / download-log /
	// enhancement-history cutoff (now minus N days) a sane date; an absurd N
	// overflows the date arithmetic and can land in the future, deleting
	// everything. The UI offers up to 365.
	MaxRetentionDays = 36_500
	// MaxAutoBackupIntervalHours (10 years) keeps time.Duration(n)*time.Hour
	// from overflowing (about 2.5 million hours), which would make the
	// "is a backup due" check always true and back up on every tick. The UI
	// offers up to 168.
	MaxAutoBackupIntervalHours = 87_600
)

// SettingMaxValues maps a numeric setting key to its inclusive upper limit.
// Only keys where a huge value does real harm are listed; see the consts above.
// Not listed on purpose (no harm found): library_page_size (only slices the
// list client-side, same as turning pagination off),
// thumbnail_enhancement_max_per_sweep and thumbnail_enhancement_min_dim (only
// compared against counts/sizes), backup_retention_count and
// system_events_retention_count (only compared against row counts).
var SettingMaxValues = map[string]int{
	SettingMaxConcurrentDownloads:            MaxConcurrentDownloadsLimit,
	SettingMaxConcurrentTranscodes:           MaxConcurrentTranscodesLimit,
	SettingThumbnailFrameCount:               MaxThumbnailFrameCount,
	SettingThumbnailEnhancementFactor:        MaxThumbnailEnhancementFactor,
	SettingThumbnailEnhancementTargetDim:     MaxThumbnailEnhancementTargetDim,
	SettingYtdlpRetries:                      MaxYtdlpRetries,
	SettingDownloadTimeoutMinutes:            MaxDownloadTimeoutMinutes,
	SettingHistoryRetentionDays:              MaxRetentionDays,
	SettingDownloadLogRetentionDays:          MaxRetentionDays,
	SettingThumbnailEnhancementRetentionDays: MaxRetentionDays,
	SettingAutoBackupIntervalHours:           MaxAutoBackupIntervalHours,
}

// SettingMaxValue returns key's upper limit, if it has one.
func SettingMaxValue(key string) (max int, ok bool) {
	max, ok = SettingMaxValues[key]
	return max, ok
}

// SettingEnums maps a setting key with a fixed list of values to that list
// (in display order). ytdlp_cookies_browser is deliberately absent: its list of
// browsers exists only in the frontend.
var SettingEnums = map[string][]string{
	SettingDefaultQuality:                 {"best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"},
	SettingDefaultDownloadType:            {"video", "audio", "image"},
	SettingLibraryView:                    {"grid", "list", "folders"},
	SettingLibraryMode:                    {"manage", "view", "details"},
	SettingImageConvertFormat:             {"original", "jpg", "png", "webp"},
	SettingPrivacyBlurStrength:            {"weak", "default", "strong"},
	SettingJellyfinRefreshMode:            {"entire", "specific", "none"},
	SettingThumbnailEnhancementTargetMode: {"factor", "resolution"},
}

// SettingEnumValues returns key's allowed values and whether key is an enum.
func SettingEnumValues(key string) (values []string, ok bool) {
	values, ok = SettingEnums[key]
	return values, ok
}

// SettingEnumKeys lists the enum keys, sorted (for tests and docs).
func SettingEnumKeys() []string {
	keys := make([]string, 0, len(SettingEnums))
	for k := range SettingEnums {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// ValidSettingEnum reports whether value is allowed for key. A key that is not
// an enum accepts anything.
func ValidSettingEnum(key, value string) bool {
	values, ok := SettingEnums[key]
	if !ok {
		return true
	}
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// SettingPair is a low/high pair of settings that must satisfy low < high.
type SettingPair struct {
	LowKey, HighKey string
	// LowDefault/HighDefault are what the getters report when a side was never
	// set (or is corrupt); the effective pair uses them for the missing side.
	LowDefault, HighDefault int
	// PositiveOnly: a stored value <= 0 counts as corrupt (falls back to the
	// default), like the resolution getters do. The frame range allows 0.
	PositiveOnly bool
	// Message is the 400 text PATCH answers with when the pair is inverted.
	Message string
}

// Defaults of the pairs (also used by the api getters).
const (
	DefaultResolutionThresholdLow           = 720
	DefaultResolutionThresholdHigh          = 2160
	DefaultThumbnailResolutionThresholdLow  = 480
	DefaultThumbnailResolutionThresholdHigh = 1080
	DefaultThumbnailFrameRangeLow           = 5
	DefaultThumbnailFrameRangeHigh          = 100
)

// SettingPairs are the low/high pairs validated together.
var SettingPairs = []SettingPair{
	{
		LowKey: SettingResolutionThresholdLow, HighKey: SettingResolutionThresholdHigh,
		LowDefault: DefaultResolutionThresholdLow, HighDefault: DefaultResolutionThresholdHigh, PositiveOnly: true,
		Message: "resolution low threshold must be less than the high threshold",
	},
	{
		LowKey: SettingThumbnailResolutionThresholdLow, HighKey: SettingThumbnailResolutionThresholdHigh,
		LowDefault: DefaultThumbnailResolutionThresholdLow, HighDefault: DefaultThumbnailResolutionThresholdHigh, PositiveOnly: true,
		Message: "thumbnail resolution low threshold must be less than the high threshold",
	},
	{
		LowKey: SettingThumbnailFrameRangeLow, HighKey: SettingThumbnailFrameRangeHigh,
		LowDefault: DefaultThumbnailFrameRangeLow, HighDefault: DefaultThumbnailFrameRangeHigh,
		Message: "thumbnail frame range low must be less than the high bound",
	},
}

// PairValid reports whether an effective pair is acceptable (low < high).
func PairValid(low, high int) bool { return low < high }

// EffectiveValue is the number for one side of the pair given its stored raw
// value (found=false when never stored): def when missing or corrupt, exactly
// as the api getters decide.
func (p SettingPair) EffectiveValue(raw string, found bool, def int) int {
	if !found {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || (p.PositiveOnly && n <= 0) {
		return def
	}
	return n
}

// Dashboard widgets that can be hidden; keep in sync with DASHBOARD_WIDGETS in
// the frontend.
var DashboardWidgetIDs = map[string]bool{
	"downloads":     true,
	"library":       true,
	"libraryGrowth": true,
	"mediaTypes":    true,
	"resolutions":   true,
	"storage":       true,
	"topArtists":    true,
	"topTags":       true,
}

// NormalizeDashboardWidgetIDs de-dupes ids (keeping first-seen order) and
// separates unknown ones, returned as the second value (PATCH rejects them,
// readers and restore drop them).
func NormalizeDashboardWidgetIDs(ids []string) (valid, unknown []string) {
	seen := make(map[string]bool, len(ids))
	valid = make([]string, 0, len(ids))
	for _, id := range ids {
		if !DashboardWidgetIDs[id] {
			unknown = append(unknown, id)
			continue
		}
		if !seen[id] {
			seen[id] = true
			valid = append(valid, id)
		}
	}
	return valid, unknown
}
