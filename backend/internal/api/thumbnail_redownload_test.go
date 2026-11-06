package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// fakeThumbYtDlp writes a stand-in yt-dlp that, like the real one invoked by
// FetchThumbnail, drops <output template>.jpg — or exits 1 when fail is set.
func fakeThumbYtDlp(t *testing.T, e *cleanupEnv, fail bool) *downloader.YtDlpService {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	script := `#!/bin/sh
echo "ERROR: boom" >&2
exit 1
`
	if !fail {
		script = `#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; fi
  shift
done
exec ffmpeg -y -loglevel error -f lavfi -i color=c=red:s=640x360 -frames:v 1 "${out%.%(ext)s}.jpg"
`
	}
	bin := filepath.Join(t.TempDir(), "yt-dlp")
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return &downloader.YtDlpService{BinPath: bin, FFmpegPath: "ffmpeg", SettingsRepo: repository.NewSettingsRepo(e.conn)}
}

func (e *cleanupEnv) redownloadThumb(t *testing.T, ytdlp *downloader.YtDlpService, id int64) (int, LibraryItemResponse, string) {
	t.Helper()
	responder := NewItemResponder(repository.NewSettingsRepo(e.conn), repository.NewCollectionsRepo(e.conn), repository.NewTagsRepo(e.conn),
		repository.NewArtistsRepo(e.conn), repository.NewThumbnailGalleryRepo(e.conn), e.downloads, e.mediaRoot)
	h := RedownloadLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, responder, e.originals)
	w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/redownload", id), "/library/:id/thumbnail/redownload", "")
	var resp LibraryItemResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, resp, w.Body.String()
}

func seedTierFile(t *testing.T, root, rel string) {
	t.Helper()
	abs := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRedownloadThumbnailGhost(t *testing.T) {
	ctx := context.Background()
	url := "https://example.test/v"

	seedGhost := func(e *cleanupEnv) (int64, string, string) {
		oldSmall, oldMedium := "library/1/old-small.webp", "library/1/old-medium.webp"
		id, err := e.library.Create(ctx, &models.LibraryItem{Title: "g", Status: "ghost", OriginalURL: &url, ThumbnailSmallPath: &oldSmall, ThumbnailMediumPath: &oldMedium})
		if err != nil {
			t.Fatal(err)
		}
		seedTierFile(t, e.imagesRoot, oldSmall)
		seedTierFile(t, e.imagesRoot, oldMedium)
		return id, oldSmall, oldMedium
	}

	t.Run("success stores tiers only and clears stale backup", func(t *testing.T) {
		e := newCleanupEnv(t)
		id, oldSmall, oldMedium := seedGhost(e)
		backup := "library/1/original.webp"
		seedTierFile(t, e.imagesRoot, backup)
		if err := e.originals.Create(ctx, id, backup); err != nil {
			t.Fatal(err)
		}

		code, _, body := e.redownloadThumb(t, fakeThumbYtDlp(t, e, false), id)
		if code != http.StatusOK {
			t.Fatalf("status = %d: %s", code, body)
		}
		got, err := e.library.Get(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.ThumbnailSmallPath == nil || got.ThumbnailMediumPath == nil {
			t.Fatalf("tiers not recorded: %+v", got)
		}
		if *got.ThumbnailSmallPath == oldSmall || *got.ThumbnailMediumPath == oldMedium {
			t.Fatalf("tier paths unchanged: %s %s", *got.ThumbnailSmallPath, *got.ThumbnailMediumPath)
		}
		if got.Thumbnail != nil {
			t.Fatalf("plain thumbnail must stay null, got %q", *got.Thumbnail)
		}
		for _, p := range []string{*got.ThumbnailSmallPath, *got.ThumbnailMediumPath} {
			if !exists(filepath.Join(e.imagesRoot, filepath.FromSlash(p))) {
				t.Errorf("new tier %s missing on disk", p)
			}
		}
		assertGone(t, filepath.Join(e.imagesRoot, oldSmall), filepath.Join(e.imagesRoot, oldMedium), filepath.Join(e.imagesRoot, backup))
		if _, err := e.originals.Get(ctx, id); err == nil {
			t.Error("stale enhancement backup row should be gone")
		}
		// The response carries the new tiers and no plain thumbnail.
		var resp LibraryItemResponse
		if err := json.Unmarshal([]byte(body), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.ThumbnailSmallPath == nil || *resp.ThumbnailSmallPath != *got.ThumbnailSmallPath ||
			resp.ThumbnailMediumPath == nil || *resp.ThumbnailMediumPath != *got.ThumbnailMediumPath || resp.Thumbnail != nil {
			t.Fatalf("response thumbnails wrong: %s", body)
		}
	})

	t.Run("fetch failure is 502 and leaves item unchanged", func(t *testing.T) {
		e := newCleanupEnv(t)
		id, oldSmall, oldMedium := seedGhost(e)
		code, _, body := e.redownloadThumb(t, fakeThumbYtDlp(t, e, true), id)
		if code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502: %s", code, body)
		}
		got, _ := e.library.Get(ctx, id)
		if got.ThumbnailSmallPath == nil || *got.ThumbnailSmallPath != oldSmall || *got.ThumbnailMediumPath != oldMedium {
			t.Fatalf("item changed: %+v", got)
		}
		if !exists(filepath.Join(e.imagesRoot, oldSmall)) || !exists(filepath.Join(e.imagesRoot, oldMedium)) {
			t.Error("old tier files must survive a failed fetch")
		}
	})

	t.Run("no source URL is 400", func(t *testing.T) {
		e := newCleanupEnv(t)
		id, err := e.library.Create(ctx, &models.LibraryItem{Title: "g", Status: "ghost"})
		if err != nil {
			t.Fatal(err)
		}
		if code, _, body := e.redownloadThumb(t, fakeThumbYtDlp(t, e, false), id); code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", code, body)
		}
	})
}

func TestRedownloadThumbnailRealItemStillUsesSidecar(t *testing.T) {
	ctx := context.Background()
	e := newCleanupEnv(t)
	url := "https://example.test/v"
	if err := os.WriteFile(filepath.Join(e.mediaRoot, "a.mp4"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	id, err := e.library.Create(ctx, &models.LibraryItem{Title: "a", Status: "completed", Filename: "a.mp4", Path: "a.mp4", OriginalURL: &url})
	if err != nil {
		t.Fatal(err)
	}
	code, _, body := e.redownloadThumb(t, fakeThumbYtDlp(t, e, false), id)
	if code != http.StatusOK {
		t.Fatalf("status = %d: %s", code, body)
	}
	got, _ := e.library.Get(ctx, id)
	if got.Thumbnail == nil || *got.Thumbnail != "a.jpg" || !exists(filepath.Join(e.mediaRoot, "a.jpg")) {
		t.Fatalf("expected sidecar a.jpg, got %+v", got.Thumbnail)
	}
}
