package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"packrat/backend/internal/framematch"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func testJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 48))
	for x := 0; x < 64; x++ {
		for y := 0; y < 48; y++ {
			img.Set(x, y, color.RGBA{R: 200, G: uint8(x * 3), B: 40, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type imageSeed struct {
	id                  int64
	media               string
	bytes               []byte
	thumbRel            string
	small, medium       string // absolute
	smallRel, mediumRel string
}

// seedImageItem creates an image item whose thumbnail is its own media file.
func (e *cleanupEnv) seedImageItem(t *testing.T, name, ext string) imageSeed {
	t.Helper()
	ctx := context.Background()
	mt := "image"
	rel := name + ext
	content := []byte("ORIGINAL-IMAGE-BYTES-" + name)
	id, err := e.library.Create(ctx, &models.LibraryItem{
		Title: name, Filename: rel, Path: rel, Status: "completed", MediaType: &mt, Thumbnail: &rel,
	})
	if err != nil {
		t.Fatal(err)
	}
	s := imageSeed{id: id, media: filepath.Join(e.mediaRoot, rel), bytes: content, thumbRel: rel}
	if err := os.WriteFile(s.media, content, 0o644); err != nil {
		t.Fatal(err)
	}
	s.smallRel = fmt.Sprintf("library/%d/small/old.webp", id)
	s.mediumRel = fmt.Sprintf("library/%d/medium/old.webp", id)
	s.small = filepath.Join(e.imagesRoot, filepath.FromSlash(s.smallRel))
	s.medium = filepath.Join(e.imagesRoot, filepath.FromSlash(s.mediumRel))
	writeFile(t, s.small)
	writeFile(t, s.medium)
	w, h := 10, 20
	if err := e.library.UpdateThumbnailTiers(ctx, id, &s.smallRel, &s.mediumRel, &w, &h); err != nil {
		t.Fatal(err)
	}
	return s
}

func (e *cleanupEnv) responder() *ItemResponder {
	return NewItemResponder(repository.NewSettingsRepo(e.conn), repository.NewCollectionsRepo(e.conn), repository.NewTagsRepo(e.conn),
		repository.NewArtistsRepo(e.conn), repository.NewThumbnailGalleryRepo(e.conn), e.downloads, e.mediaRoot)
}

func mediaFiles(t *testing.T, root string) []string {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, en := range entries {
		out = append(out, en.Name())
	}
	return out
}

func assertImageUntouched(t *testing.T, e *cleanupEnv, s imageSeed, files []string) {
	t.Helper()
	got, err := os.ReadFile(s.media)
	if err != nil || !bytes.Equal(got, s.bytes) {
		t.Fatalf("media file changed: %v %q", err, got)
	}
	if now := mediaFiles(t, e.mediaRoot); fmt.Sprint(now) != fmt.Sprint(files) {
		t.Fatalf("media folder changed: before %v after %v", files, now)
	}
	it, _ := e.library.Get(context.Background(), s.id)
	if it.Thumbnail == nil || *it.Thumbnail != s.thumbRel {
		t.Fatalf("thumbnail pointer changed: %v", it.Thumbnail)
	}
}

func TestImageItemRejectedEndpoints(t *testing.T) {
	e := newCleanupEnv(t)
	s := e.seedImageItem(t, "pic", ".jpg")
	files := mediaFiles(t, e.mediaRoot)
	ytdlp := fakeThumbYtDlp(t, e, false)
	url := "https://example.test/i"
	if _, err := e.conn.Exec(`UPDATE library SET original_url = ? WHERE id = ?`, url, s.id); err != nil {
		t.Fatal(err)
	}
	before, _ := e.library.Get(context.Background(), s.id)

	cases := map[string]func() int{
		"delete": func() int {
			return e.do(t, DeleteLibraryItemThumbnail(e.mediaRoot, e.imagesRoot, e.library, e.originals), http.MethodDelete, fmt.Sprintf("/library/%d/thumbnail", s.id), "/library/:id/thumbnail", "").Code
		},
		"redownload": func() int {
			code, _, _ := e.redownloadThumb(t, ytdlp, s.id)
			return code
		},
		"quickgrab": func() int {
			h := QuickGrabLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, "ffprobe", repository.NewSettingsRepo(e.conn), e.responder(), e.originals)
			return e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/quick-grab", s.id), "/library/:id/thumbnail/quick-grab", "").Code
		},
		"framematch": func() int {
			h := StartFrameMatch(e.mediaRoot, e.library, ytdlp, "ffprobe", framematch.NewJobStore(), e.queue)
			return e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/frame-match", s.id), "/library/:id/frame-match", `{"mode":"current"}`).Code
		},
	}
	for name, run := range cases {
		if code := run(); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, code)
		}
	}
	assertImageUntouched(t, e, s, files)
	after, _ := e.library.Get(context.Background(), s.id)
	if *after.ThumbnailSmallPath != *before.ThumbnailSmallPath || !exists(s.small) || !exists(s.medium) {
		t.Fatalf("row/tiers changed")
	}
}

func TestBulkFrameMatchSkipsImageItems(t *testing.T) {
	e := newCleanupEnv(t)
	s := e.seedImageItem(t, "pic", ".png")
	h := BulkStartFrameMatch(e.library, e.queue, e.downloads)
	w := e.do(t, h, http.MethodPost, "/library/frame-match/bulk", "/library/frame-match/bulk", fmt.Sprintf(`{"itemIds":[%d],"mode":"current"}`, s.id))
	if w.Code != http.StatusAccepted {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	resp := decode[BulkFrameMatchResponse](t, w.Body.Bytes())
	if resp.Queued != 0 || resp.Skipped != 1 {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestImageItemSetThumbnailIsTiersOnly(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
	for _, ext := range []string{".jpg", ".png"} {
		for _, via := range []string{"set", "gallery"} {
			t.Run(via+ext, func(t *testing.T) {
				e := newCleanupEnv(t)
				s := e.seedImageItem(t, "pic", ext)
				files := mediaFiles(t, e.mediaRoot)
				data := testJPEG(t)
				var code int
				var body string
				if via == "set" {
					h := SetLibraryThumbnail(e.mediaRoot, e.imagesRoot, "ffmpeg", e.library, e.responder(), e.originals)
					w := e.do(t, h, http.MethodPut, fmt.Sprintf("/library/%d/thumbnail", s.id), "/library/:id/thumbnail",
						fmt.Sprintf(`{"imageBase64":%q}`, base64.StdEncoding.EncodeToString(data)))
					code, body = w.Code, w.Body.String()
				} else {
					gal := repository.NewThumbnailGalleryRepo(e.conn)
					rel := fmt.Sprintf("thumbnail-gallery/%d/g.jpg", s.id)
					if err := os.MkdirAll(filepath.Join(e.imagesRoot, "thumbnail-gallery", fmt.Sprint(s.id)), 0o755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(e.imagesRoot, filepath.FromSlash(rel)), data, 0o644); err != nil {
						t.Fatal(err)
					}
					gid, err := gal.Create(context.Background(), s.id, rel, nil, nil, nil)
					if err != nil {
						t.Fatal(err)
					}
					h := ApplyLibraryThumbnailFromGallery(e.mediaRoot, e.imagesRoot, "ffmpeg", e.library, gal, e.responder(), e.originals)
					w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/gallery/%d/apply", s.id, gid), "/library/:id/thumbnail/gallery/:galleryId/apply", "")
					code, body = w.Code, w.Body.String()
				}
				if code != http.StatusOK {
					t.Fatalf("status %d: %s", code, body)
				}
				assertImageUntouched(t, e, s, files)
				it, _ := e.library.Get(context.Background(), s.id)
				if it.ThumbnailSmallPath == nil || *it.ThumbnailSmallPath == s.smallRel || *it.ThumbnailMediumPath == s.mediumRel {
					t.Fatalf("tiers not replaced: %v %v", it.ThumbnailSmallPath, it.ThumbnailMediumPath)
				}
				if !exists(filepath.Join(e.imagesRoot, *it.ThumbnailSmallPath)) || !exists(filepath.Join(e.imagesRoot, *it.ThumbnailMediumPath)) {
					t.Fatal("new tiers missing on disk")
				}
				assertGone(t, s.small, s.medium)
			})
		}
	}
}

func TestPathIsMedia(t *testing.T) {
	mt := "image"
	item := &models.LibraryItem{Path: "a/b.jpg", MediaType: &mt}
	root := filepath.Join("x", "media")
	if !pathIsMedia(root, item, filepath.Join(root, "a", "b.jpg")) || pathIsMedia(root, item, filepath.Join(root, "a", "b.png")) {
		t.Fatal("pathIsMedia wrong")
	}
	if pathIsMedia(root, &models.LibraryItem{}, root) {
		t.Fatal("ghost must not match the root")
	}
}

func TestDeleteImageItemFile(t *testing.T) {
	for _, withThumb := range []bool{false, true} {
		t.Run(fmt.Sprint("deleteThumbnail=", withThumb), func(t *testing.T) {
			e := newCleanupEnv(t)
			s := e.seedImageItem(t, "pic", ".jpg")
			h := DeleteLibraryItemFile(e.library, e.originals, itemlock.New(), e.mediaRoot, e.imagesRoot)
			w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d/file?deleteThumbnail=%v", s.id, withThumb), "/library/:id/file", "")
			if w.Code != http.StatusNoContent {
				t.Fatalf("status %d", w.Code)
			}
			assertGone(t, s.media)
			it, _ := e.library.Get(context.Background(), s.id)
			if it.Thumbnail != nil || it.Path != "" {
				t.Fatalf("thumbnail/path not cleared: %+v", it)
			}
			if withThumb {
				assertGone(t, s.small, s.medium)
				if it.ThumbnailSmallPath != nil {
					t.Fatal("tier pointers should be cleared")
				}
			} else if it.ThumbnailSmallPath == nil || !exists(s.small) || !exists(s.medium) {
				t.Fatal("tiers must stay")
			}
		})
	}
}

func TestBulkDeleteMixedImageAndVideo(t *testing.T) {
	for _, withThumb := range []bool{false, true} {
		t.Run(fmt.Sprint("deleteThumbnail=", withThumb), func(t *testing.T) {
			e := newCleanupEnv(t)
			img := e.seedImageItem(t, "pic", ".png")
			vid := e.seedItem(t, "vid")
			h := BulkDeleteLibraryItemFiles(e.conn, e.library, e.downloads, e.originals, itemlock.New(), e.mediaRoot, e.imagesRoot)
			w := e.do(t, h, http.MethodPost, "/library/bulk-delete-file", "/library/bulk-delete-file",
				fmt.Sprintf(`{"itemIds":[%d,%d],"deleteThumbnail":%v}`, img.id, vid.id, withThumb))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			assertGone(t, img.media, vid.media)
			ii, _ := e.library.Get(context.Background(), img.id)
			vi, _ := e.library.Get(context.Background(), vid.id)
			if ii.Thumbnail != nil {
				t.Fatal("image thumbnail pointer must be cleared")
			}
			if withThumb {
				assertGone(t, img.small, vid.thumb)
			} else {
				if !exists(img.small) || !exists(vid.thumb) {
					t.Fatal("tiers / video thumbnail must stay")
				}
				if vi.Thumbnail == nil {
					t.Fatal("video thumbnail pointer must stay (unchanged behaviour)")
				}
			}
		})
	}
}
