package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

func restoreEvents(t *testing.T, e *atomicEnv) []models.SystemEvent {
	t.Helper()
	evs, _, err := e.events.Query(t.Context(), repository.SystemEventQuery{Categories: []string{sysevents.CategoryRestore}, Sort: "createdAt", Desc: false, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	return evs
}

type adjustedDetails struct {
	Source      string `json:"source"`
	Count       int    `json:"count"`
	Adjustments []struct {
		Key    string `json:"key"`
		Action string `json:"action"`
		From   *int   `json:"from"`
		To     *int   `json:"to"`
	} `json:"adjustments"`
}

var restorePaths = []struct{ name, path, kind string }{
	{"settings import", "/import/settings", "settings"},
	{"full import", "/import/full", "full"},
}

func sealSettings(t *testing.T, kind string, settings map[string]string) map[string]any {
	t.Helper()
	var payload any = settings
	if kind == "full" {
		payload = backup.FullBundle{Settings: settings}
	}
	return sealImport(t, kind, payload)
}

func TestRestoreAdjustmentsAreLoggedOnce(t *testing.T) {
	const secret = "SECRET-TEXT-FROM-THE-FILE"
	for _, tc := range restorePaths {
		t.Run(tc.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			w := e.do(http.MethodPost, tc.path, sealSettings(t, tc.kind, map[string]string{
				models.SettingMaxConcurrentDownloads:     "10000000",
				models.SettingMaxConcurrentTranscodes:    "5000",
				models.SettingDefaultQuality:             secret,
				models.SettingDashboardHiddenWidgets:     `["storage","` + secret + `"]`,
				models.SettingResolutionThresholdLow:     "9000",
				models.SettingResolutionThresholdHigh:    "100",
				models.SettingLibraryView:                "list",
				models.SettingThumbnailEnhancementFactor: "9999",
			}))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			// The HTTP response is unchanged: applied counts the values written.
			if !strings.Contains(w.Body.String(), `"applied":5`) && !strings.Contains(w.Body.String(), `"settingsApplied":5`) {
				t.Errorf("body %s", w.Body)
			}

			evs := restoreEvents(t, e)
			if len(evs) != 2 {
				t.Fatalf("want the completed event plus one adjusted event, got %d: %+v", len(evs), evs)
			}
			var adjusted *models.SystemEvent
			for i := range evs {
				if strings.Contains(evs[i].Message, "adjusted") {
					adjusted = &evs[i]
				}
			}
			if adjusted == nil {
				t.Fatalf("no adjusted event: %+v", evs)
			}
			if adjusted.Level != sysevents.LevelWarning || adjusted.Message != "Settings restore adjusted 7 values" {
				t.Errorf("level %q message %q", adjusted.Level, adjusted.Message)
			}
			if strings.Contains(string(adjusted.Details), secret) {
				t.Errorf("file text leaked into the log: %s", adjusted.Details)
			}
			var d adjustedDetails
			if err := json.Unmarshal(adjusted.Details, &d); err != nil {
				t.Fatal(err)
			}
			if d.Count != 7 || len(d.Adjustments) != 7 {
				t.Fatalf("details = %+v", d)
			}
			byKey := map[string]int{}
			for i, a := range d.Adjustments {
				byKey[a.Key] = i
			}
			c := d.Adjustments[byKey[models.SettingMaxConcurrentDownloads]]
			if c.Action != backup.AdjustClamped || c.From == nil || *c.From != 10000000 || c.To == nil || *c.To != models.MaxConcurrentDownloadsLimit {
				t.Errorf("clamp entry = %+v", c)
			}
			if q := d.Adjustments[byKey[models.SettingDefaultQuality]]; q.Action != backup.AdjustSkipped || q.From != nil || q.To != nil {
				t.Errorf("enum entry = %+v", q)
			}
			if wdg := d.Adjustments[byKey[models.SettingDashboardHiddenWidgets]]; wdg.Action != backup.AdjustDropped {
				t.Errorf("widget entry = %+v", wdg)
			}
		})
	}
}

func TestRestoreWithoutAdjustmentsRecordsNoExtraEvent(t *testing.T) {
	for _, tc := range restorePaths {
		t.Run(tc.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			w := e.do(http.MethodPost, tc.path, sealSettings(t, tc.kind, map[string]string{
				models.SettingMaxConcurrentDownloads: "4",
				models.SettingLibraryView:            "folders",
				"library_sort":                       "title:asc", // retired: silent, not an adjustment
			}))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			evs := restoreEvents(t, e)
			if len(evs) != 1 || !strings.HasSuffix(evs[0].Message, "completed") {
				t.Fatalf("want only the completed event, got %+v", evs)
			}
		})
	}
}

// One event per restore, however many values: the list is capped, the count is the total.
func TestRestoreAdjustedListIsCapped(t *testing.T) {
	e := newAtomicEnv(t)
	settings := map[string]string{}
	for _, key := range []string{
		models.SettingMaxConcurrentDownloads, models.SettingMaxConcurrentTranscodes, models.SettingThumbnailFrameCount,
		models.SettingThumbnailEnhancementFactor, models.SettingThumbnailEnhancementTargetDim, models.SettingYtdlpRetries,
		models.SettingDownloadTimeoutMinutes, models.SettingHistoryRetentionDays, models.SettingDownloadLogRetentionDays,
		models.SettingThumbnailEnhancementRetentionDays, models.SettingAutoBackupIntervalHours,
	} {
		settings[key] = "999999999"
	}
	for _, key := range models.SettingEnumKeys() {
		settings[key] = "bogus"
	}
	settings[models.SettingDashboardHiddenWidgets] = `["x"]`
	settings[models.SettingResolutionThresholdLow] = "9"
	settings[models.SettingResolutionThresholdHigh] = "1"
	settings[models.SettingThumbnailFrameRangeLow] = "9"
	settings[models.SettingThumbnailFrameRangeHigh] = "1"
	total := 11 + len(models.SettingEnums) + 1 + 4

	if w := e.do(http.MethodPost, "/import/settings", sealSettings(t, "settings", settings)); w.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", w.Code, w.Body)
	}
	var found int
	for _, ev := range restoreEvents(t, e) {
		if !strings.Contains(ev.Message, "adjusted") {
			continue
		}
		found++
		var d adjustedDetails
		if err := json.Unmarshal(ev.Details, &d); err != nil {
			t.Fatal(err)
		}
		if d.Count != total || len(d.Adjustments) != maxAdjustmentsListed || ev.Message != "Settings restore adjusted "+strconv.Itoa(total)+" values" {
			t.Errorf("message %q count %d listed %d, want total %d listed %d", ev.Message, d.Count, len(d.Adjustments), total, maxAdjustmentsListed)
		}
	}
	if found != 1 {
		t.Fatalf("want exactly one adjusted event, got %d", found)
	}
}

// The running worker pool and transcode limit follow what was stored (clamped).
func TestRestoreAppliesClampedLimitsLive(t *testing.T) {
	for _, tc := range restorePaths {
		t.Run(tc.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			w := e.do(http.MethodPost, tc.path, sealSettings(t, tc.kind, map[string]string{
				models.SettingMaxConcurrentDownloads:  "10000000",
				models.SettingMaxConcurrentTranscodes: "123456",
			}))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			if got, want := e.mgr.WorkerCount(), models.MaxConcurrentDownloadsLimit; got != want {
				t.Errorf("pool = %d, want %d", got, want)
			}
			if got, want := e.ytdlp.MaxConcurrentTranscodes(), models.MaxConcurrentTranscodesLimit; got != want {
				t.Errorf("transcodes = %d, want %d (stored %s)", got, want, e.get(models.SettingMaxConcurrentTranscodes))
			}
			if got := e.get(models.SettingMaxConcurrentTranscodes); got != strconv.Itoa(models.MaxConcurrentTranscodesLimit) {
				t.Errorf("stored transcodes = %q", got)
			}
		})
	}
}

// A frame-range clamp is listed in the System log event with numbers only.
func TestRestoreFrameRangeClampIsLogged(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPost, "/import/settings", sealSettings(t, "settings", map[string]string{
		models.SettingThumbnailFrameRangeHigh: "500",
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", w.Code, w.Body)
	}
	if got := e.get(models.SettingThumbnailFrameRangeHigh); got != "100" {
		t.Errorf("stored %q", got)
	}
	for _, ev := range restoreEvents(t, e) {
		if !strings.Contains(ev.Message, "adjusted") {
			continue
		}
		var d adjustedDetails
		if err := json.Unmarshal(ev.Details, &d); err != nil {
			t.Fatal(err)
		}
		if d.Count != 1 || len(d.Adjustments) != 1 {
			t.Fatalf("details = %+v", d)
		}
		a := d.Adjustments[0]
		if a.Key != models.SettingThumbnailFrameRangeHigh || a.Action != backup.AdjustClamped || a.From == nil || *a.From != 500 || a.To == nil || *a.To != 100 {
			t.Errorf("entry = %+v", a)
		}
		return
	}
	t.Fatal("no adjusted event")
}
