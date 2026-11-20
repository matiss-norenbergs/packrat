package backup

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func stored(t *testing.T, repo *repository.SettingsRepo, key string) (string, bool) {
	t.Helper()
	v, err := repo.Get(context.Background(), key)
	if errors.Is(err, repository.ErrNotFound) {
		return "", false
	}
	if err != nil {
		t.Fatal(err)
	}
	return v, true
}

func findAdj(adj []SettingAdjustment, key string) *SettingAdjustment {
	for i := range adj {
		if adj[i].Key == key {
			return &adj[i]
		}
	}
	return nil
}

func TestApplySettingsBundle_ClampsOverCapNumbers(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	bundle := map[string]string{}
	for key, max := range models.SettingMaxValues {
		bundle[key] = strconv.Itoa(max + 1000)
	}
	res, err := ApplySettingsBundle(ctx, repos.settings, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied != len(bundle) || len(res.Adjustments) != len(bundle) {
		t.Fatalf("applied %d, adjustments %d, want %d each", res.Applied, len(res.Adjustments), len(bundle))
	}
	for key, max := range models.SettingMaxValues {
		if got, _ := stored(t, repos.settings, key); got != strconv.Itoa(max) {
			t.Errorf("%s stored %q, want %d", key, got, max)
		}
		if res.Written[key] != strconv.Itoa(max) {
			t.Errorf("%s written %q, want %d", key, res.Written[key], max)
		}
		a := findAdj(res.Adjustments, key)
		if a == nil || a.Action != AdjustClamped || a.From == nil || a.To == nil || *a.From != max+1000 || *a.To != max {
			t.Errorf("%s adjustment = %+v", key, a)
		}
	}
	// At the limit, and the absurd/garbage values the getters already handle, are written as they are.
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingYtdlpRetries:           "100",
		models.SettingHistoryRetentionDays:   "-5",
		models.SettingDownloadTimeoutMinutes: "lots",
		models.SettingThumbnailFrameCount:    "99999999999999999999999",
	})
	if err != nil || res.Applied != 4 || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if got, _ := stored(t, repos.settings, models.SettingHistoryRetentionDays); got != "-5" {
		t.Errorf("negative must stay verbatim, got %q", got)
	}
}

func TestApplySettingsBundle_SkipsUnknownEnumValues(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	before, _ := repos.settings.GetAll(ctx)

	bundle := map[string]string{models.SettingMaxConcurrentDownloads: "3"}
	for _, key := range models.SettingEnumKeys() {
		bundle[key] = "SECRET-from-the-file"
	}
	res, err := ApplySettingsBundle(ctx, repos.settings, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied != 1 {
		t.Fatalf("applied = %d, want 1 (only the valid key)", res.Applied)
	}
	if len(res.Adjustments) != len(models.SettingEnums) {
		t.Fatalf("adjustments = %+v", res.Adjustments)
	}
	after, _ := repos.settings.GetAll(ctx)
	for _, key := range models.SettingEnumKeys() {
		if after[key] != before[key] {
			t.Errorf("%s changed from %q to %q", key, before[key], after[key])
		}
		a := findAdj(res.Adjustments, key)
		if a == nil || a.Action != AdjustSkipped || a.From != nil || a.To != nil {
			t.Errorf("%s adjustment = %+v", key, a)
		}
		if a != nil && (a.Reason != ReasonUnknownValue) {
			t.Errorf("reason must be fixed text, got %q", a.Reason)
		}
	}
	// A valid value of every enum is written.
	good := map[string]string{}
	for key, values := range models.SettingEnums {
		good[key] = values[len(values)-1]
	}
	res, err = ApplySettingsBundle(ctx, repos.settings, good)
	if err != nil || res.Applied != len(good) || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
}

func TestApplySettingsBundle_DropsUnknownWidgets(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	res, err := ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingDashboardHiddenWidgets: `["storage","nope","topTags","storage"]`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied != 1 || len(res.Adjustments) != 1 || res.Adjustments[0].Action != AdjustDropped {
		t.Fatalf("res = %+v", res)
	}
	if got, _ := stored(t, repos.settings, models.SettingDashboardHiddenWidgets); got != `["storage","topTags"]` {
		t.Errorf("stored %q", got)
	}
	// Nothing unknown: written verbatim, no adjustment. Not-a-list text is also verbatim.
	for _, v := range []string{`["library","library"]`, `not json`} {
		res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingDashboardHiddenWidgets: v})
		if err != nil || res.Applied != 1 || len(res.Adjustments) != 0 {
			t.Fatalf("%q: err=%v res=%+v", v, err, res)
		}
		if got, _ := stored(t, repos.settings, models.SettingDashboardHiddenWidgets); got != v {
			t.Errorf("stored %q, want %q", got, v)
		}
	}
}

func TestApplySettingsBundle_InvertedPairs(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	set := func(k, v string) {
		if err := repos.settings.Set(ctx, k, v); err != nil {
			t.Fatal(err)
		}
	}
	set(models.SettingResolutionThresholdLow, "480")
	set(models.SettingResolutionThresholdHigh, "1440")

	// Both sides in the bundle, inverted: both skipped, stored pair unchanged.
	res, err := ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingResolutionThresholdLow:  "2160",
		models.SettingResolutionThresholdHigh: "720",
		models.SettingMaxConcurrentDownloads:  "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied != 1 || len(res.Adjustments) != 2 {
		t.Fatalf("res = %+v", res)
	}
	if lo, _ := stored(t, repos.settings, models.SettingResolutionThresholdLow); lo != "480" {
		t.Errorf("low = %q", lo)
	}
	if hi, _ := stored(t, repos.settings, models.SettingResolutionThresholdHigh); hi != "1440" {
		t.Errorf("high = %q", hi)
	}

	// One side only: judged against the stored other side.
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingResolutionThresholdLow: "1440"})
	if err != nil || res.Applied != 0 || len(res.Adjustments) != 1 || res.Adjustments[0].Action != AdjustSkipped || res.Adjustments[0].Reason != ReasonPairInverted {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingResolutionThresholdLow: "1080"})
	if err != nil || res.Applied != 1 || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if lo, _ := stored(t, repos.settings, models.SettingResolutionThresholdLow); lo != "1080" {
		t.Errorf("low = %q", lo)
	}

	// Nothing stored: the default of the missing side is used (frame range 5..100).
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingThumbnailFrameRangeHigh: "3"})
	if err != nil || res.Applied != 0 || len(res.Adjustments) != 1 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if _, ok := stored(t, repos.settings, models.SettingThumbnailFrameRangeHigh); ok {
		t.Error("an inverted lone side must not be written")
	}
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingThumbnailResolutionThresholdLow:  "100",
		models.SettingThumbnailResolutionThresholdHigh: "200",
	})
	if err != nil || res.Applied != 2 || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
}

// Validation never fails a restore, and the result only counts what was written.
func TestApplySettingsBundle_NeverFailsOnBadValues(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	bundle := map[string]string{
		"library_sort":                        "title:asc", // retired
		models.SettingMaxConcurrentDownloads:  "99999999",
		models.SettingDefaultQuality:          "bogus",
		models.SettingLibraryView:             "grid",
		models.SettingResolutionThresholdLow:  "9000",
		models.SettingResolutionThresholdHigh: "100",
		"some_unrecognized_key":               "kept like before",
	}
	res, err := ApplySettingsBundle(ctx, repos.settings, bundle)
	if err != nil {
		t.Fatalf("a restore must not fail on validation: %v", err)
	}
	// written: max_concurrent_downloads (clamped), library_view, the unrecognized key.
	if res.Applied != 3 || len(res.Written) != 3 {
		t.Fatalf("applied %d written %v", res.Applied, res.Written)
	}
	if res.Written[models.SettingMaxConcurrentDownloads] != "16" {
		t.Errorf("written = %v", res.Written)
	}
	if got := len(res.Adjustments); got != 4 { // clamp + enum + two pair sides
		t.Errorf("adjustments = %+v", res.Adjustments)
	}
	if v, ok := stored(t, repos.settings, "some_unrecognized_key"); !ok || v != "kept like before" {
		t.Errorf("unrecognized key handling changed: %q %v", v, ok)
	}
	if _, ok := stored(t, repos.settings, "library_sort"); ok {
		t.Error("retired key written")
	}
	// Adjustments are in a stable order.
	again, _ := ApplySettingsBundle(ctx, repos.settings, bundle)
	if !reflect.DeepEqual(res.Adjustments, again.Adjustments) {
		t.Errorf("order not stable:\n%+v\n%+v", res.Adjustments, again.Adjustments)
	}
}

func TestApplySettingsBundle_ClampsFrameRange(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)

	res, err := ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingThumbnailFrameRangeLow:  "-20",
		models.SettingThumbnailFrameRangeHigh: "500",
	})
	if err != nil || res.Applied != 2 || len(res.Adjustments) != 2 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	for key, want := range map[string][2]int{
		models.SettingThumbnailFrameRangeLow:  {-20, 0},
		models.SettingThumbnailFrameRangeHigh: {500, 100},
	} {
		if got, _ := stored(t, repos.settings, key); got != strconv.Itoa(want[1]) {
			t.Errorf("%s stored %q, want %d", key, got, want[1])
		}
		a := findAdj(res.Adjustments, key)
		if a == nil || a.Action != AdjustClamped || a.From == nil || a.To == nil || *a.From != want[0] || *a.To != want[1] {
			t.Errorf("%s adjustment = %+v", key, a)
		}
	}

	// In range (edges included): stored unchanged, nothing reported.
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingThumbnailFrameRangeLow:  "0",
		models.SettingThumbnailFrameRangeHigh: "100",
	})
	if err != nil || res.Applied != 2 || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}

	// Not a number: left to the getters, as before.
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingThumbnailFrameRangeHigh: "lots"})
	if err != nil || res.Applied != 1 || len(res.Adjustments) != 0 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
}

// The pair is judged on the clamped values: 150/120 both become 100, which is not
// low < high, so both sides are skipped (the stored pair stays). The two clamps are
// still reported (they were applied to the file's values before the pair was
// judged), followed by the two skips.
func TestApplySettingsBundle_PairUsesClampedFrameRange(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	if err := repos.settings.Set(ctx, models.SettingThumbnailFrameRangeLow, "10"); err != nil {
		t.Fatal(err)
	}
	if err := repos.settings.Set(ctx, models.SettingThumbnailFrameRangeHigh, "90"); err != nil {
		t.Fatal(err)
	}
	res, err := ApplySettingsBundle(ctx, repos.settings, map[string]string{
		models.SettingThumbnailFrameRangeLow:  "150",
		models.SettingThumbnailFrameRangeHigh: "120",
	})
	if err != nil || res.Applied != 0 || len(res.Adjustments) != 4 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	var clamped, skipped int
	for _, a := range res.Adjustments {
		switch {
		case a.Action == AdjustClamped && a.From != nil && a.To != nil && *a.To == 100:
			clamped++
		case a.Action == AdjustSkipped && a.Reason == ReasonPairInverted:
			skipped++
		}
	}
	if clamped != 2 || skipped != 2 {
		t.Errorf("adjustments = %+v", res.Adjustments)
	}
	if lo, _ := stored(t, repos.settings, models.SettingThumbnailFrameRangeLow); lo != "10" {
		t.Errorf("low = %q", lo)
	}
	if hi, _ := stored(t, repos.settings, models.SettingThumbnailFrameRangeHigh); hi != "90" {
		t.Errorf("high = %q", hi)
	}

	// A lone out-of-range side is clamped, then judged against the stored other side.
	res, err = ApplySettingsBundle(ctx, repos.settings, map[string]string{models.SettingThumbnailFrameRangeHigh: "500"})
	if err != nil || res.Applied != 1 || len(res.Adjustments) != 1 {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if hi, _ := stored(t, repos.settings, models.SettingThumbnailFrameRangeHigh); hi != "100" {
		t.Errorf("high = %q", hi)
	}
}
