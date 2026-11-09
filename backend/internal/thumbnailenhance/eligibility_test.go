package thumbnailenhance

import (
	"context"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/thumbwrite"
)

// elig is a library with every case the eligibility rule distinguishes.
type elig struct {
	*fixture
	small, big []byte
	names      map[int64]string
	seq        int
}

func newElig(t *testing.T) *elig {
	t.Helper()
	e := &elig{fixture: newFixture(t, false), names: map[int64]string{}}
	e.small = pngBytes(t, 4, color.RGBA{R: 1, A: 255})
	e.big = pngBytes(t, 800, color.RGBA{G: 1, A: 255})
	e.names[e.itemID] = "fixture" // 4x4 file, stored dims 4x4 -> eligible
	e.stamp(e.itemID)
	return e
}

// stamp gives the row a unique, increasing downloaded_at (List's sort key), so
// the order is unambiguous.
func (e *elig) stamp(id int64) {
	e.seq++
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(e.seq) * time.Minute).Format("2006-01-02 15:04:05")
	if _, err := e.conn.Exec(`UPDATE library SET downloaded_at = ? WHERE id = ?`, ts, id); err != nil {
		e.t.Fatal(err)
	}
}

// add inserts an item. file: nil = no file written; storedW/H nil = NULL dims.
func (e *elig) add(name string, file []byte, thumbnail bool, path string, storedW, storedH *int) int64 {
	e.t.Helper()
	rel := "show/" + name + ".png"
	if file != nil {
		if err := os.WriteFile(filepath.Join(e.deps.MediaRoot, filepath.FromSlash(rel)), file, 0o644); err != nil {
			e.t.Fatal(err)
		}
	}
	item := &models.LibraryItem{Title: name, Filename: name + ".mp4", Path: path, Status: "completed"}
	if thumbnail {
		item.Thumbnail = &rel
	}
	id, err := e.deps.LibraryRepo.Create(context.Background(), item)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.conn.Exec(`UPDATE library SET thumbnail_width = ?, thumbnail_height = ? WHERE id = ?`, storedW, storedH, id); err != nil {
		e.t.Fatal(err)
	}
	e.stamp(id)
	e.names[id] = name
	return id
}

func ip(n int) *int { return &n }

func (e *elig) build(bulk int) (failed int64) {
	vid := "show/" + "x.mp4"
	s, b := 4, 800
	e.add("stored-small", e.small, true, vid, ip(s), ip(s))             // eligible
	e.add("stored-big", e.big, true, vid, ip(b), ip(b))                 // above minDim by stored dims: never opened
	e.add("null-small", e.small, true, vid, nil, nil)                   // legacy, eligible, dims get stored
	e.add("null-big", e.big, true, vid, nil, nil)                       // legacy, not eligible, dims get stored
	e.add("ghost", e.small, true, "", ip(s), ip(s))                     // no media file
	e.add("no-thumb", nil, false, vid, nil, nil)                        // no thumbnail
	e.add("missing-file", nil, true, vid, ip(s), ip(s))                 // candidate, but the file is gone
	e.add("replaced-outside", e.big, true, vid, ip(s), ip(s))           // stored says small, file is big: file wins
	e.add("half-null", e.small, true, vid, ip(s), nil)                  // one dimension missing = never probed
	failed = e.add("recently-failed", e.small, true, vid, ip(s), ip(s)) // eligible but inside the cooldown
	for i := 0; i < bulk; i++ {
		// Above minDim by stored dimensions; no file on disk at all, so any probe of these would fail the count.
		e.add(fmt.Sprintf("bulk-%d", i), nil, true, vid, ip(b), ip(b))
	}
	if _, err := e.deps.HistoryRepo.Create(context.Background(), &models.ThumbnailEnhancementHistoryEntry{
		LibraryItemID: &failed, ItemTitle: "recently-failed", Status: "failed", TriggerType: "scheduled", Mode: "upscale",
	}); err != nil {
		e.t.Fatal(err)
	}
	return failed
}

// reference is the old behavior: List everything, probe every thumbnail.
func (e *elig) reference(cfg config, skipRecent bool) []eligibleCandidate {
	items, err := e.deps.LibraryRepo.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	failures, err := e.deps.HistoryRepo.RecentlyFailedItemIDs(context.Background(), time.Now().Add(-failureCooldown))
	if err != nil {
		e.t.Fatal(err)
	}
	var out []eligibleCandidate
	for _, item := range items {
		if item.Path == "" || item.Thumbnail == nil {
			continue
		}
		abs := filepath.Join(e.deps.MediaRoot, filepath.FromSlash(*item.Thumbnail))
		w, h, size, err := thumbwrite.Probe(abs)
		if err != nil {
			continue
		}
		longest := w
		if h > longest {
			longest = h
		}
		if longest >= cfg.minDim {
			continue
		}
		var failedAt *time.Time
		if at, ok := failures[item.ID]; ok {
			if skipRecent {
				continue
			}
			tt := at
			failedAt = &tt
		}
		out = append(out, eligibleCandidate{item: item, thumbAbs: abs, width: w, height: h, size: size, artistName: item.ArtistName, collectionName: item.CollectionName, recentlyFailedAt: failedAt})
	}
	return out
}

// summary reduces candidates to what callers use (item id, probe results, failure annotation).
func summary(cs []eligibleCandidate) []string {
	var out []string
	for _, c := range cs {
		f := "-"
		if c.recentlyFailedAt != nil {
			f = c.recentlyFailedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, fmt.Sprintf("%d|%s|%dx%d|%d|%s", c.item.ID, c.thumbAbs, c.width, c.height, c.size, f))
	}
	return out
}

// countProbes swaps the probe seam for a counter for the rest of the test.
func countProbes(t *testing.T) (count *atomic.Int32, probed *[]string) {
	t.Helper()
	var n atomic.Int32
	var paths []string
	orig := probeThumbnail
	probeThumbnail = func(abs string) (int, int, int64, error) {
		n.Add(1)
		paths = append(paths, filepath.Base(abs))
		return orig(abs)
	}
	t.Cleanup(func() { probeThumbnail = orig })
	return &n, &paths
}

func TestFindEligibleMatchesFullScan(t *testing.T) {
	e := newElig(t)
	e.build(300)
	cfg := config{minDim: 720}
	for _, skip := range []bool{true, false} {
		want := summary(e.reference(cfg, skip))
		got, err := findEligible(context.Background(), e.deps, cfg, skip)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(summary(got), want) {
			t.Fatalf("skipRecent=%v:\nwant %v\ngot  %v", skip, want, summary(got))
		}
		if len(want) < 3 {
			t.Fatalf("fixture too weak: %d eligible", len(want))
		}
	}
	// Spot-check the expected membership (newest downloaded first).
	got, _ := findEligible(context.Background(), e.deps, cfg, false)
	var names []string
	for _, c := range got {
		names = append(names, e.names[c.item.ID])
	}
	// Newest downloaded first, i.e. the reverse of insertion order.
	if !reflect.DeepEqual(names, []string{"recently-failed", "half-null", "null-small", "stored-small", "fixture"}) {
		t.Errorf("eligible = %v", names)
	}
	if got[0].recentlyFailedAt == nil {
		t.Errorf("recently failed item must be annotated for manual triggers")
	}
}

func TestSweepProbesOnlyCandidates(t *testing.T) {
	e := newElig(t)
	e.build(500) // 500 items above minDim by stored dimensions, no files on disk
	n, probed := countProbes(t)
	cfg := config{minDim: 720}
	if _, err := findEligible(context.Background(), e.deps, cfg, true); err != nil {
		t.Fatal(err)
	}
	// Candidates: fixture, stored-small, null-small, null-big, missing-file, replaced-outside, half-null, recently-failed.
	if got := n.Load(); got != 8 {
		t.Fatalf("probed %d files (%v), want the 8 candidates only", got, *probed)
	}
}

func TestNullDimensionsStoredAfterProbeAndSkippedNextTime(t *testing.T) {
	e := newElig(t)
	e.build(10)
	n, _ := countProbes(t)
	cfg := config{minDim: 720}
	if _, err := findEligible(context.Background(), e.deps, cfg, true); err != nil {
		t.Fatal(err)
	}
	first := n.Load()

	dims := func(name string) (w, h *int) {
		for id, nm := range e.names {
			if nm == name {
				it, err := e.deps.LibraryRepo.Get(context.Background(), id)
				if err != nil {
					t.Fatal(err)
				}
				return it.ThumbnailWidth, it.ThumbnailHeight
			}
		}
		t.Fatalf("no item %s", name)
		return
	}
	for name, want := range map[string]int{"null-big": 800, "null-small": 4, "half-null": 4} {
		w, h := dims(name)
		if w == nil || h == nil || *w != want || *h != want {
			t.Errorf("%s dims = %v x %v, want %d", name, w, h, want)
		}
	}

	n.Store(0)
	if _, err := findEligible(context.Background(), e.deps, cfg, true); err != nil {
		t.Fatal(err)
	}
	if got := n.Load(); got != first-1 {
		t.Errorf("second pass probed %d, want %d (null-big no longer a candidate)", got, first-1)
	}
}

// MaybeAutoEnhanceOnDownload opens exactly one file whatever the library size,
// and enhances the item when eligible.
func TestMaybeAutoEnhanceOnDownloadProbesOneFile(t *testing.T) {
	e := newElig(t)
	e.build(400)
	client := e.upscaler(e.big)
	ctx := context.Background()
	for k, v := range map[string]string{
		models.SettingThumbnailEnhancementEnabled:        "true",
		models.SettingThumbnailEnhancementAutoOnDownload: "true",
		models.SettingThumbnailEnhancementURL:            client.BaseURL,
	} {
		if err := e.deps.SettingsRepo.Set(ctx, k, v); err != nil {
			t.Fatal(err)
		}
	}
	n, _ := countProbes(t)

	// An item that cannot be enhanced (no file): still exactly one probe.
	var bigID int64
	for id, nm := range e.names {
		if nm == "stored-big" {
			bigID = id
		}
	}
	if err := MaybeAutoEnhanceOnDownload(ctx, e.deps, bigID); err != nil {
		t.Fatal(err)
	}
	if got := n.Load(); got != 1 {
		t.Fatalf("ineligible item: probed %d files, want 1", got)
	}

	// The eligible fixture item: one eligibility probe, then it is enhanced.
	n.Store(0)
	if err := MaybeAutoEnhanceOnDownload(ctx, e.deps, e.itemID); err != nil {
		t.Fatal(err)
	}
	if got := n.Load(); got != 1 {
		t.Fatalf("eligible item: %d eligibility probes, want 1", got)
	}
	if w, _, _, err := thumbwrite.Probe(e.thumbAbs); err != nil || w != 800 {
		t.Fatalf("sidecar after auto-enhance is %dx? (err %v), want the 800px upscale", w, err)
	}
	if statuses := e.historyStatuses(); !reflect.DeepEqual(statuses, []string{"failed", "success"}) {
		t.Errorf("history = %v", statuses)
	}

	// Unknown item and a recently failed one are quiet no-ops.
	n.Store(0)
	if err := MaybeAutoEnhanceOnDownload(ctx, e.deps, 999999); err != nil {
		t.Fatal(err)
	}
	if n.Load() != 0 {
		t.Errorf("unknown id probed %d files", n.Load())
	}
}

func TestEnhanceItemsFetchesOnlyRequested(t *testing.T) {
	e := newElig(t)
	e.build(400)
	client := e.upscaler(e.big)
	ctx := context.Background()
	for k, v := range map[string]string{
		models.SettingThumbnailEnhancementEnabled: "true",
		models.SettingThumbnailEnhancementURL:     client.BaseURL,
	} {
		if err := e.deps.SettingsRepo.Set(ctx, k, v); err != nil {
			t.Fatal(err)
		}
	}
	n, _ := countProbes(t)
	ids := []int64{e.itemID, 424242} // an unknown id is skipped quietly
	for id, nm := range e.names {
		if nm == "stored-big" {
			ids = append(ids, id) // stored above minDim and no file: skipped
		}
	}
	if err := EnhanceItems(ctx, e.deps, ids); err != nil {
		t.Fatal(err)
	}
	if got := n.Load(); got != 2 {
		t.Errorf("probed %d files for 2 existing ids", got)
	}
	if w, _, _, _ := thumbwrite.Probe(e.thumbAbs); w != 800 {
		t.Errorf("requested eligible item was not enhanced (width %d)", w)
	}
}
