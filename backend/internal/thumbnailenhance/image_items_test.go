package thumbnailenhance

import (
	"bytes"
	"context"
	"errors"
	"image/color"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"packrat/backend/internal/models"
)

// asImageItem turns the fixture's item into an image item: its thumbnail IS
// its media file (media path == sidecar path), the layout a downloaded image has.
func (f *fixture) asImageItem() {
	f.t.Helper()
	if _, err := f.conn.Exec(`UPDATE library SET media_type = 'image', filename = 'Video.png', path = 'show/Video.png' WHERE id = ?`, f.itemID); err != nil {
		f.t.Fatal(err)
	}
}

// countingUpscaler counts the requests that reach the "Stable Diffusion" service.
func (f *fixture) countingUpscaler(_ []byte) (*Client, *atomic.Int32) {
	f.t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		http.Error(w, "must not be called", http.StatusInternalServerError)
	}))
	f.t.Cleanup(srv.Close)
	return NewClient(srv.URL, "", ""), &n
}

func (f *fixture) enableEnhancement(c *Client, autoOnDownload bool) {
	f.t.Helper()
	ctx := context.Background()
	set := func(k, v string) {
		if err := f.deps.SettingsRepo.Set(ctx, k, v); err != nil {
			f.t.Fatal(err)
		}
	}
	set(models.SettingThumbnailEnhancementEnabled, "true")
	set(models.SettingThumbnailEnhancementURL, c.BaseURL)
	if autoOnDownload {
		set(models.SettingThumbnailEnhancementAutoOnDownload, "true")
	}
}

func TestEnhanceOneRefusesAnImageItem(t *testing.T) {
	for _, mode := range []string{modeUpscale, modeSharpen} {
		t.Run(mode, func(t *testing.T) {
			f := newFixture(t, false)
			f.asImageItem()
			client, hits := f.countingUpscaler(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))
			before := f.snapshot()
			it := f.item()
			cfg := config{minDim: 720, factor: 4, targetMode: "factor", upscaler: "u"}
			err := enhanceOne(context.Background(), f.deps, client, cfg, *it, f.thumbAbs, 4, 4, int64(len(f.original)), "manual", mode)
			if !errors.Is(err, ErrThumbnailIsMedia) {
				t.Fatalf("err = %v, want ErrThumbnailIsMedia", err)
			}
			f.assertUnchanged(before)
			got, _ := os.ReadFile(f.thumbAbs)
			if !bytes.Equal(got, f.original) {
				t.Error("the image file's bytes changed")
			}
			if f.backupRows() != 0 {
				t.Error("a backup row was created")
			}
			if h := f.historyStatuses(); len(h) != 0 {
				t.Errorf("history rows recorded: %v", h)
			}
			if hits.Load() != 0 {
				t.Errorf("the upscaler was called %d times", hits.Load())
			}
		})
	}
}

func TestEnhanceOneRefusesAThumbnailThatIsTheMediaFile(t *testing.T) {
	f := newFixture(t, false)
	// Not an image item by type (a video row), but its sidecar path is its media path.
	if _, err := f.conn.Exec(`UPDATE library SET path = 'show/Video.png' WHERE id = ?`, f.itemID); err != nil {
		t.Fatal(err)
	}
	client, hits := f.countingUpscaler(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))
	before := f.snapshot()
	// A non-normalized sidecar spelling of the same file must be caught too.
	spelled := filepath.Join(f.deps.MediaRoot, "show", "..", "show", "Video.png")
	it := f.item()
	cfg := config{minDim: 720, factor: 4, targetMode: "factor", upscaler: "u"}
	err := enhanceOne(context.Background(), f.deps, client, cfg, *it, spelled, 4, 4, 1, "manual", modeUpscale)
	if !errors.Is(err, ErrThumbnailIsMedia) {
		t.Fatalf("err = %v, want ErrThumbnailIsMedia", err)
	}
	f.assertUnchanged(before)
	if f.backupRows() != 0 || len(f.historyStatuses()) != 0 || hits.Load() != 0 {
		t.Errorf("backups=%d history=%v upscaler calls=%d", f.backupRows(), f.historyStatuses(), hits.Load())
	}
}

func TestEveryEntryPointSkipsAnImageItem(t *testing.T) {
	f := newFixture(t, false)
	f.asImageItem()
	client, hits := f.countingUpscaler(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))
	f.enableEnhancement(client, true)
	ctx := context.Background()
	before := f.snapshot()

	if n, err := WouldRunCount(ctx, f.deps); err != nil || n != 0 {
		t.Errorf("WouldRunCount = %d, %v; want 0", n, err)
	}
	if items, err := ListEligible(ctx, f.deps); err != nil || len(items) != 0 {
		t.Errorf("ListEligible = %v, %v; want none", items, err)
	}
	if n, err := RunOnce(ctx, f.deps); err != nil || n != 0 {
		t.Errorf("RunOnce = %d, %v; want 0", n, err)
	}
	if err := EnhanceItems(ctx, f.deps, []int64{f.itemID}); err != nil {
		t.Error(err)
	}
	if err := SharpenItems(ctx, f.deps, []int64{f.itemID}); err != nil {
		t.Error(err)
	}
	if err := MaybeAutoEnhanceOnDownload(ctx, f.deps, f.itemID); err != nil {
		t.Error(err)
	}
	if hits.Load() != 0 {
		t.Errorf("the upscaler was called %d times", hits.Load())
	}
	f.assertUnchanged(before)
	if f.backupRows() != 0 || len(f.historyStatuses()) != 0 {
		t.Error("a backup or history row was created")
	}
}

func TestLegacyImageRowWithNullMediaTypeIsSkipped(t *testing.T) {
	f := newFixture(t, false)
	if _, err := f.conn.Exec(`UPDATE library SET media_type = NULL, filename = 'Video.png', path = 'show/Video.png' WHERE id = ?`, f.itemID); err != nil {
		t.Fatal(err)
	}
	client, hits := f.countingUpscaler(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))
	f.enableEnhancement(client, false)
	if err := SharpenItems(context.Background(), f.deps, []int64{f.itemID}); err != nil {
		t.Fatal(err)
	}
	if items, _ := ListEligible(context.Background(), f.deps); len(items) != 0 {
		t.Errorf("legacy image row is eligible: %v", items)
	}
	if hits.Load() != 0 {
		t.Errorf("the upscaler was called %d times", hits.Load())
	}
}

// Anyone affected by the old behaviour must still be able to undo it: revert
// (and the backup/history bookkeeping around it) is not guarded.
func TestRevertStillWorksForAnImageItemWithABackup(t *testing.T) {
	f := newFixture(t, false)
	f.asImageItem()
	ctx := context.Background()

	// Hand-built state: the image file was overwritten by an old enhancement.
	enhanced := pngBytes(t, 8, color.RGBA{G: 200, A: 255})
	if err := os.WriteFile(f.thumbAbs, enhanced, 0o640); err != nil {
		t.Fatal(err)
	}
	if created, err := backupOriginalIfAbsent(ctx, f.deps, f.itemID, f.original); err != nil || !created {
		t.Fatalf("building the backup: %v %v", created, err)
	}

	if err := RevertOriginal(ctx, f.deps, f.itemID); err != nil {
		t.Fatalf("revert: %v", err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, f.original) {
		t.Error("the original image bytes were not restored")
	}
	if f.backupRows() != 0 {
		t.Error("the backup row survived a successful revert")
	}
	// Keep Enhanced (DeleteOriginal) is the other half; nothing in it is guarded either.
	if _, err := backupOriginalIfAbsent(ctx, f.deps, f.itemID, f.original); err != nil {
		t.Fatal(err)
	}
	if err := DeleteOriginal(ctx, f.deps, f.itemID); err != nil || f.backupRows() != 0 {
		t.Errorf("DeleteOriginal: %v (backup rows %d)", err, f.backupRows())
	}
}
