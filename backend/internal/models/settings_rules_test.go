package models

import (
	"reflect"
	"testing"
)

func TestSettingMaxValues(t *testing.T) {
	cases := map[string]int{
		SettingMaxConcurrentDownloads:            16,
		SettingMaxConcurrentTranscodes:           16,
		SettingThumbnailFrameCount:               50,
		SettingThumbnailEnhancementFactor:        16,
		SettingThumbnailEnhancementTargetDim:     16384,
		SettingYtdlpRetries:                      100,
		SettingDownloadTimeoutMinutes:            5_256_000,
		SettingHistoryRetentionDays:              36_500,
		SettingDownloadLogRetentionDays:          36_500,
		SettingThumbnailEnhancementRetentionDays: 36_500,
		SettingAutoBackupIntervalHours:           87_600,
	}
	if len(cases) != len(SettingMaxValues) {
		t.Fatalf("table has %d keys, SettingMaxValues %d", len(cases), len(SettingMaxValues))
	}
	for key, want := range cases {
		got, ok := SettingMaxValue(key)
		if !ok || got != want {
			t.Errorf("%s: got (%d, %v), want %d", key, got, ok, want)
		}
	}
	for _, key := range []string{SettingLibraryPageSize, SettingThumbnailEnhancementMaxPerSweep, SettingThumbnailEnhancementMinDim, SettingDefaultQuality} {
		if _, ok := SettingMaxValue(key); ok {
			t.Errorf("%s should have no cap", key)
		}
	}
}

// The caps that guard time.Duration arithmetic must really be safe.
func TestCapsDoNotOverflowDurations(t *testing.T) {
	const maxDuration = int64(1<<63 - 1)
	if int64(MaxDownloadTimeoutMinutes)*60_000_000_000 <= 0 || int64(MaxDownloadTimeoutMinutes) > maxDuration/60_000_000_000 {
		t.Error("download timeout cap overflows time.Duration")
	}
	if int64(MaxAutoBackupIntervalHours) > maxDuration/3_600_000_000_000 {
		t.Error("auto backup interval cap overflows time.Duration")
	}
}

func TestValidSettingEnum(t *testing.T) {
	for _, tc := range []struct {
		key, value string
		want       bool
	}{
		{SettingDefaultQuality, "1080p", true},
		{SettingDefaultQuality, "144p", false},
		{SettingDefaultQuality, "", false},
		{SettingDefaultDownloadType, "audio", true},
		{SettingDefaultDownloadType, "gif", false},
		{SettingLibraryView, "folders", true},
		{SettingLibraryView, "table", false},
		{SettingLibraryMode, "details", true},
		{SettingLibraryMode, "edit", false},
		{SettingImageConvertFormat, "webp", true},
		{SettingImageConvertFormat, "bmp", false},
		{SettingPrivacyBlurStrength, "strong", true},
		{SettingPrivacyBlurStrength, "max", false},
		{SettingJellyfinRefreshMode, "specific", true},
		{SettingJellyfinRefreshMode, "all", false},
		{SettingThumbnailEnhancementTargetMode, "resolution", true},
		{SettingThumbnailEnhancementTargetMode, "auto", false},
		{SettingYtdlpCookiesBrowser, "anything", true}, // not an enum in code
		{SettingJellyfinURL, "anything", true},
	} {
		if got := ValidSettingEnum(tc.key, tc.value); got != tc.want {
			t.Errorf("ValidSettingEnum(%s, %q) = %v, want %v", tc.key, tc.value, got, tc.want)
		}
	}
	want := []string{"default_download_type", "default_quality", "image_convert_format", "jellyfin_refresh_mode", "library_mode", "library_view", "privacy_blur_strength", "thumbnail_enhancement_target_mode"}
	if got := SettingEnumKeys(); !reflect.DeepEqual(got, want) {
		t.Errorf("enum keys = %v, want %v", got, want)
	}
}

func TestPairs(t *testing.T) {
	if !PairValid(1, 2) || PairValid(2, 2) || PairValid(3, 2) {
		t.Error("PairValid must be strict low < high")
	}
	if len(SettingPairs) != 3 {
		t.Fatalf("got %d pairs", len(SettingPairs))
	}
	res, frame := SettingPairs[0], SettingPairs[2]
	for _, tc := range []struct {
		name  string
		p     SettingPair
		raw   string
		found bool
		def   int
		want  int
	}{
		{"missing uses default", res, "", false, 720, 720},
		{"valid", res, "480", true, 720, 480},
		{"garbage uses default", res, "abc", true, 720, 720},
		{"non-positive resolution uses default", res, "0", true, 720, 720},
		{"frame range allows 0", frame, "0", true, 5, 0},
		{"frame range garbage uses default", frame, "x", true, 5, 5},
	} {
		if got := tc.p.EffectiveValue(tc.raw, tc.found, tc.def); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestNormalizeDashboardWidgetIDs(t *testing.T) {
	valid, unknown := NormalizeDashboardWidgetIDs([]string{"storage", "bogus", "topTags", "storage", "<script>"})
	if !reflect.DeepEqual(valid, []string{"storage", "topTags"}) || !reflect.DeepEqual(unknown, []string{"bogus", "<script>"}) {
		t.Errorf("valid=%v unknown=%v", valid, unknown)
	}
}

func TestSettingRanges(t *testing.T) {
	if len(SettingRanges) != 2 {
		t.Fatalf("got %d ranges", len(SettingRanges))
	}
	for _, key := range []string{SettingThumbnailFrameRangeLow, SettingThumbnailFrameRangeHigh} {
		r, ok := SettingRange(key)
		if !ok || r.Min != 0 || r.Max != 100 {
			t.Fatalf("%s range = %+v, %v", key, r, ok)
		}
		for _, tc := range []struct{ in, want int }{{-1, 0}, {-20, 0}, {0, 0}, {50, 50}, {100, 100}, {101, 100}, {500, 100}} {
			if got := r.Clamp(tc.in); got != tc.want {
				t.Errorf("%s Clamp(%d) = %d, want %d", key, tc.in, got, tc.want)
			}
		}
	}
	if _, ok := SettingRange(SettingYtdlpRetries); ok {
		t.Error("ytdlp_retries has no two-sided range")
	}
}
