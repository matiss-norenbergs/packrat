package api

import (
	"fmt"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// Every capped key (except downloads, which has its own test), by its PATCH name.
var patchCapFields = []struct{ field, key string }{
	{"maxConcurrentTranscodes", models.SettingMaxConcurrentTranscodes},
	{"downloadTimeoutMinutes", models.SettingDownloadTimeoutMinutes},
	{"historyRetentionDays", models.SettingHistoryRetentionDays},
	{"downloadLogRetentionDays", models.SettingDownloadLogRetentionDays},
	{"autoBackupIntervalHours", models.SettingAutoBackupIntervalHours},
	{"thumbnailFrameCount", models.SettingThumbnailFrameCount},
	{"ytdlpRetries", models.SettingYtdlpRetries},
	{"thumbnailEnhancementFactor", models.SettingThumbnailEnhancementFactor},
	{"thumbnailEnhancementTargetDim", models.SettingThumbnailEnhancementTargetDim},
	{"thumbnailEnhancementRetentionDays", models.SettingThumbnailEnhancementRetentionDays},
}

var patchEnumFields = []struct{ field, key string }{
	{"defaultQuality", models.SettingDefaultQuality},
	{"defaultDownloadType", models.SettingDefaultDownloadType},
	{"libraryView", models.SettingLibraryView},
	{"libraryMode", models.SettingLibraryMode},
	{"imageConvertFormat", models.SettingImageConvertFormat},
	{"privacyBlurStrength", models.SettingPrivacyBlurStrength},
	{"jellyfinRefreshMode", models.SettingJellyfinRefreshMode},
	{"thumbnailEnhancementTargetMode", models.SettingThumbnailEnhancementTargetMode},
}

// Fields whose request DTO accepts only the UI's fixed list of numbers (stricter
// than the shared cap, which still applies to a settings import / restore).
var strictSetFields = map[string]bool{"autoBackupIntervalHours": true, "thumbnailFrameCount": true}

func TestPatchCapsAreEnforced(t *testing.T) {
	if len(patchCapFields)+1 != len(models.SettingMaxValues) {
		t.Fatalf("test table covers %d keys, rules have %d (+downloads)", len(patchCapFields)+1, len(models.SettingMaxValues))
	}
	for _, f := range patchCapFields {
		t.Run(f.field, func(t *testing.T) {
			e := newAtomicEnv(t)
			max, _ := models.SettingMaxValue(f.key)
			before, _ := e.settings.GetAll(t.Context())

			w := e.do(http.MethodPatch, "/settings", map[string]any{f.field: max + 1})
			if w.Code != http.StatusBadRequest {
				t.Fatalf("max+1: status %d, body %s", w.Code, w.Body)
			}
			if !strictSetFields[f.field] && (!strings.Contains(w.Body.String(), f.field) || !strings.Contains(w.Body.String(), strconv.Itoa(max))) {
				t.Errorf("message should name the field and limit: %s", w.Body)
			}
			if after, _ := e.settings.GetAll(t.Context()); !reflect.DeepEqual(before, after) {
				t.Error("a rejected PATCH changed the settings")
			}
			if strictSetFields[f.field] {
				return // the request DTO only accepts the UI's fixed list; the cap backs restore
			}
			if w := e.do(http.MethodPatch, "/settings", map[string]any{f.field: max}); w.Code != http.StatusNoContent {
				t.Fatalf("max: status %d, body %s", w.Code, w.Body)
			}
			if got := e.get(f.key); got != strconv.Itoa(max) {
				t.Errorf("stored %q, want %d", got, max)
			}
		})
	}
}

// A rejected request changes nothing, even for the valid fields next to the bad one.
func TestPatchRejectsWholeRequest(t *testing.T) {
	e := newAtomicEnv(t)
	before, _ := e.settings.GetAll(t.Context())
	w := e.do(http.MethodPatch, "/settings", map[string]any{"libraryView": "list", "defaultQuality": "144p"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "defaultQuality must be one of") {
		t.Errorf("message: %s", w.Body)
	}
	if after, _ := e.settings.GetAll(t.Context()); !reflect.DeepEqual(before, after) {
		t.Error("a rejected request changed the settings")
	}
}

func TestPatchRejectsUnknownEnumValues(t *testing.T) {
	for _, f := range patchEnumFields {
		t.Run(f.field, func(t *testing.T) {
			e := newAtomicEnv(t)
			before, _ := e.settings.GetAll(t.Context())
			w := e.do(http.MethodPatch, "/settings", map[string]any{f.field: "definitely-not-valid"})
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			if !strings.Contains(w.Body.String(), f.field+" must be one of") {
				t.Errorf("message: %s", w.Body)
			}
			if after, _ := e.settings.GetAll(t.Context()); !reflect.DeepEqual(before, after) {
				t.Error("a rejected PATCH changed the settings")
			}
		})
	}
	if len(patchEnumFields) != len(models.SettingEnums) {
		t.Fatalf("test covers %d enums, rules have %d", len(patchEnumFields), len(models.SettingEnums))
	}
}

func TestPatchRejectsInvertedPairs(t *testing.T) {
	for _, tc := range []struct {
		name string
		body map[string]any
	}{
		{"video both", map[string]any{"resolutionThresholdLow": 2160, "resolutionThresholdHigh": 1080}},
		{"video lone low vs stored default high", map[string]any{"resolutionThresholdLow": 4320}},
		{"thumbnail equal", map[string]any{"thumbnailResolutionThresholdLow": 720, "thumbnailResolutionThresholdHigh": 720}},
		{"frame range lone high below default low", map[string]any{"thumbnailFrameRangeHigh": 3}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			w := e.do(http.MethodPatch, "/settings", tc.body)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "must be less than") {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			all, _ := e.settings.GetAll(t.Context())
			for _, key := range []string{models.SettingResolutionThresholdLow, models.SettingResolutionThresholdHigh, models.SettingThumbnailResolutionThresholdLow, models.SettingThumbnailResolutionThresholdHigh, models.SettingThumbnailFrameRangeLow, models.SettingThumbnailFrameRangeHigh} {
				if _, ok := all[key]; ok {
					t.Errorf("%s was written by a rejected request", key)
				}
			}
		})
	}
}

// Every value the Settings UI can send must pass (derived from the frontend's
// selects, presets and number inputs).
func TestPatchAcceptsEveryUIValue(t *testing.T) {
	var cases []map[string]any
	add := func(field string, values ...any) {
		for _, v := range values {
			cases = append(cases, map[string]any{field: v})
		}
	}
	add("defaultQuality", "best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst")
	add("defaultDownloadType", "video", "audio", "image")
	add("libraryView", "grid", "folders", "list")
	add("libraryMode", "manage", "details")
	add("imageConvertFormat", "original", "jpg", "png", "webp")
	add("privacyBlurStrength", "weak", "default", "strong")
	add("jellyfinRefreshMode", "none", "entire", "specific")
	add("thumbnailEnhancementTargetMode", "factor", "resolution")
	add("maxConcurrentDownloads", 1, 4, 16)
	add("maxConcurrentTranscodes", 1, 2, 8)
	add("downloadTimeoutMinutes", 0, 30, 1440)
	add("thumbnailFrameCount", 2, 4, 6, 8, 12, 24)
	add("historyRetentionDays", 7, 30, 90, 365, 0)
	add("downloadLogRetentionDays", 7, 30, 90, 365, 0)
	add("thumbnailEnhancementRetentionDays", 7, 30, 90, 365, 0)
	add("autoBackupIntervalHours", 0, 6, 12, 24, 72, 168)
	add("backupRetentionCount", 7, 14, 30, 50, 100, 0)
	add("systemEventsRetentionCount", 500, 1000, 5000, 10000, 0)
	add("ytdlpRetries", 0, 3, 10, 50)
	add("thumbnailEnhancementFactor", 1, 2, 3, 4)
	add("thumbnailEnhancementTargetDim", 1, 1280, 1920, 2560, 3840)
	add("thumbnailEnhancementMinDim", 480, 720, 1080, 1440, 2160)
	add("thumbnailEnhancementMaxPerSweep", 5, 10, 20, 50)
	add("libraryPageSize", 24, 48, 96, 200)
	add("jellyfinURL", "")
	add("ytdlpCookiesBrowser", "", "firefox", "chrome")
	for _, c := range cases {
		t.Run(fmt.Sprint(c), func(t *testing.T) {
			e := newAtomicEnv(t)
			if w := e.do(http.MethodPatch, "/settings", c); w.Code != http.StatusNoContent {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
		})
	}
}
