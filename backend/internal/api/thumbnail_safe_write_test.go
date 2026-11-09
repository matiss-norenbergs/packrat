package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbwrite"
)

// Failure-injection tests for the five handlers that replace the sidecar thumbnail
// (quick grab, set, gallery apply, frame-match accept, redownload): a failed action must
// leave the sidecar, the row, the old derivatives and the AI-enhancement backup as they
// were, and no temp or scratch file may remain.

func solidJPEG(t *testing.T, size int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for x := 0; x < size; x++ {
		for y := 0; y < size; y++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type writeMode int

const (
	modeOK          writeMode = iota
	modeGarbage               // the image bytes are not an image
	modeTierFails             // the encoder (ffmpeg) fails on the tiers
	modeDBFails               // thumbwrite's database update fails
	modeRenameFails           // thumbwrite's final rename fails
)

type swEnv struct {
	*cleanupEnv
	t        *testing.T
	id       int64
	thumbAbs string
	oldBytes []byte
	newBytes []byte // 8x8
	oldSmall string // absolute
	oldMed   string
	backup   string // absolute
}

func newSWEnv(t *testing.T) *swEnv {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fakes need a POSIX shell")
	}
	e := &swEnv{cleanupEnv: newCleanupEnv(t), t: t}
	e.oldBytes = solidJPEG(t, 4, color.RGBA{R: 200, A: 255})
	e.newBytes = solidJPEG(t, 8, color.RGBA{G: 200, A: 255})
	mediaAbs := filepath.Join(e.mediaRoot, "show", "Video.mp4")
	e.thumbAbs = filepath.Join(e.mediaRoot, "show", "Video.jpg")
	for p, b := range map[string][]byte{mediaAbs: []byte("video"), e.thumbAbs: e.oldBytes} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	thumb, url, dur, mt := "show/Video.jpg", "https://example.test/v", 60, "video"
	id, err := e.library.Create(ctx, &models.LibraryItem{Title: "Video", Filename: "Video.mp4", Path: "show/Video.mp4", MediaType: &mt,
		Status: "available", Thumbnail: &thumb, OriginalURL: &url, Duration: &dur})
	if err != nil {
		t.Fatal(err)
	}
	e.id = id
	small, med := fmt.Sprintf("library/%d/small/old.webp", id), fmt.Sprintf("library/%d/medium/old.webp", id)
	e.oldSmall, e.oldMed = filepath.Join(e.imagesRoot, filepath.FromSlash(small)), filepath.Join(e.imagesRoot, filepath.FromSlash(med))
	writeFile(t, e.oldSmall)
	writeFile(t, e.oldMed)
	w, h := 4, 4
	if err := e.library.UpdateThumbnailTiers(ctx, id, &small, &med, &w, &h); err != nil {
		t.Fatal(err)
	}
	backupRel := fmt.Sprintf("library/%d/original.webp", id)
	e.backup = filepath.Join(e.imagesRoot, filepath.FromSlash(backupRel))
	writeFile(t, e.backup)
	if err := e.originals.Create(ctx, id, backupRel); err != nil {
		t.Fatal(err)
	}
	return e
}

// fakeFFmpeg is a stand-in encoder: "-f image2" (frame grab) prints frame to stdout, and every
// .webp output argument is created (or the process fails when tierFail is set).
func (e *swEnv) fakeFFmpeg(frame []byte, tierFail bool) string {
	e.t.Helper()
	dir := e.t.TempDir()
	frameFile := filepath.Join(dir, "frame.bin")
	if err := os.WriteFile(frameFile, frame, 0o644); err != nil {
		e.t.Fatal(err)
	}
	body := fmt.Sprintf("#!/bin/sh\ncase \"$*\" in *image2*) cat %q; exit 0;; esac\n", frameFile)
	if tierFail {
		body += "echo 'encoder exploded' >&2\nexit 1\n"
	} else {
		body += "for a in \"$@\"; do case \"$a\" in *.webp) printf webp > \"$a\" ;; esac; done\n"
	}
	path := filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		e.t.Fatal(err)
	}
	return path
}

// fakeYtDlp drops the jpg (and, like a real run, intermediate leftovers) at the -o template.
func (e *swEnv) fakeYtDlp(jpg []byte, ffmpeg string, fail bool) *downloader.YtDlpService {
	e.t.Helper()
	dir := e.t.TempDir()
	src := filepath.Join(dir, "thumb.bin")
	if err := os.WriteFile(src, jpg, 0o644); err != nil {
		e.t.Fatal(err)
	}
	body := fmt.Sprintf(`#!/bin/sh
while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done
base="${out%%.%%(ext)s}"
echo leftover > "$base.webp"
echo leftover > "$base.jpg.part"
`) + fmt.Sprintf("if [ -n %q ]; then echo 'ERROR: boom' >&2; exit 1; fi\ncp %q \"$base.jpg\"\n", map[bool]string{true: "fail"}[fail], src)
	bin := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(bin, []byte(body), 0o755); err != nil {
		e.t.Fatal(err)
	}
	return &downloader.YtDlpService{BinPath: bin, FFmpegPath: ffmpeg, SettingsRepo: repository.NewSettingsRepo(e.conn)}
}

// ---- snapshots ----

type swState struct {
	sidecar       []byte
	thumb         *string
	small, medium *string
	w, h          *int
	media, images []string
	backupRow     bool
	backupFile    bool
}

func (e *swEnv) snapshot() swState {
	b, _ := os.ReadFile(e.thumbAbs)
	it, err := e.library.Get(context.Background(), e.id)
	if err != nil {
		e.t.Fatal(err)
	}
	_, berr := e.originals.Get(context.Background(), e.id)
	return swState{b, it.Thumbnail, it.ThumbnailSmallPath, it.ThumbnailMediumPath, it.ThumbnailWidth, it.ThumbnailHeight,
		withoutScratchRoot(mediaFiles(e.t, e.mediaRoot)), mediaFiles(e.t, e.imagesRoot), berr == nil, exists(e.backup)}
}

// diff names what differs between two snapshots ("" when equal).
func (a swState) diff(b swState) string {
	deref := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}
	derefI := func(p *int) string {
		if p == nil {
			return "<nil>"
		}
		return fmt.Sprint(*p)
	}
	var d []string
	if !bytes.Equal(a.sidecar, b.sidecar) {
		d = append(d, "sidecar bytes")
	}
	if deref(a.thumb) != deref(b.thumb) {
		d = append(d, fmt.Sprintf("thumbnail %s -> %s", deref(a.thumb), deref(b.thumb)))
	}
	if deref(a.small) != deref(b.small) || deref(a.medium) != deref(b.medium) {
		d = append(d, fmt.Sprintf("tiers %s,%s -> %s,%s", deref(a.small), deref(a.medium), deref(b.small), deref(b.medium)))
	}
	if derefI(a.w) != derefI(b.w) || derefI(a.h) != derefI(b.h) {
		d = append(d, fmt.Sprintf("dimensions %sx%s -> %sx%s", derefI(a.w), derefI(a.h), derefI(b.w), derefI(b.h)))
	}
	if !reflect.DeepEqual(a.media, b.media) {
		d = append(d, fmt.Sprintf("media files %v -> %v", a.media, b.media))
	}
	if !reflect.DeepEqual(a.images, b.images) {
		d = append(d, fmt.Sprintf("image files %v -> %v", a.images, b.images))
	}
	if a.backupRow != b.backupRow || a.backupFile != b.backupFile {
		d = append(d, fmt.Sprintf("AI backup row/file %v/%v -> %v/%v", a.backupRow, a.backupFile, b.backupRow, b.backupFile))
	}
	return strings.Join(d, "; ")
}

// assertUnchanged compares against before, ignoring the input files the gallery and
// frame-match cases create themselves.
func (e *swEnv) assertUnchanged(before swState) {
	e.t.Helper()
	if !before.backupRow || !before.backupFile {
		e.t.Fatal("test setup: the AI-enhancement backup should exist")
	}
	after := e.snapshot()
	after.images, before.images = withoutFixtureFiles(after.images), withoutFixtureFiles(before.images)
	if d := before.diff(after); d != "" {
		e.t.Errorf("state changed after a failed action: %s", d)
	}
}

// withoutScratchRoot drops the shared (empty) scratch root itself; scratchLeftovers asserts
// that nothing is inside it.
func withoutScratchRoot(in []string) []string {
	var out []string
	for _, f := range in {
		if f != ".packrat-tmp" {
			out = append(out, f)
		}
	}
	return out
}

func hasThumbTemp(t *testing.T, root string) bool {
	t.Helper()
	for _, f := range mediaFiles(t, root) {
		if fsutil.IsThumbTmpName(filepath.Base(f)) {
			return true
		}
	}
	return false
}

// ---- the five handlers behind one call signature ----

type swHandler struct {
	name string
	// garbage400 is true when undecodable bytes come from the client.
	garbage400 bool
	// call performs the request; data is what the handler should end up writing.
	call func(e *swEnv, data []byte, ffmpeg string) *httptest.ResponseRecorder
}

func swHandlers() []swHandler {
	return []swHandler{
		{name: "set", garbage400: true, call: func(e *swEnv, data []byte, ff string) *httptest.ResponseRecorder {
			h := SetLibraryThumbnail(e.mediaRoot, e.imagesRoot, ff, e.library, e.responder(), e.originals, e.mgr.ItemLocks())
			return e.do(e.t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail", e.id), "/library/:id/thumbnail",
				fmt.Sprintf(`{"imageBase64":%q}`, base64.StdEncoding.EncodeToString(data)))
		}},
		{name: "quickgrab", call: func(e *swEnv, data []byte, ff string) *httptest.ResponseRecorder {
			// ff prints the frame to stdout for "-f image2"; the frame is the data under test.
			ytdlp := &downloader.YtDlpService{BinPath: "unused", FFmpegPath: ff, SettingsRepo: repository.NewSettingsRepo(e.conn)}
			h := QuickGrabLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, "ffprobe", repository.NewSettingsRepo(e.conn), e.responder(), e.originals, e.mgr.ItemLocks())
			return e.do(e.t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/quick-grab", e.id), "/library/:id/thumbnail/quick-grab", "")
		}},
		{name: "gallery", call: func(e *swEnv, data []byte, ff string) *httptest.ResponseRecorder {
			gal := repository.NewThumbnailGalleryRepo(e.conn)
			rel := fmt.Sprintf("thumbnail-gallery/%d/g.jpg", e.id)
			abs := filepath.Join(e.imagesRoot, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				e.t.Fatal(err)
			}
			if err := os.WriteFile(abs, data, 0o644); err != nil {
				e.t.Fatal(err)
			}
			gid, err := gal.Create(context.Background(), e.id, rel, nil, nil, nil)
			if err != nil {
				e.t.Fatal(err)
			}
			h := ApplyLibraryThumbnailFromGallery(e.mediaRoot, e.imagesRoot, ff, e.library, gal, e.responder(), e.originals, e.mgr.ItemLocks())
			return e.do(e.t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/gallery/%d/apply", e.id, gid), "/library/:id/thumbnail/gallery/:galleryId/apply", "")
		}},
		{name: "framematch", call: func(e *swEnv, data []byte, ff string) *httptest.ResponseRecorder {
			qid, err := e.queue.Create(context.Background(), e.id, "Video", "current")
			if err != nil {
				e.t.Fatal(err)
			}
			rel := fmt.Sprintf("frame-match/%d/found.jpg", qid)
			abs := filepath.Join(e.imagesRoot, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				e.t.Fatal(err)
			}
			if err := os.WriteFile(abs, data, 0o644); err != nil {
				e.t.Fatal(err)
			}
			if err := e.queue.SetDone(context.Background(), qid, 1, 0.9, rel, rel); err != nil {
				e.t.Fatal(err)
			}
			h := AcceptFrameMatchQueueItem(e.mediaRoot, e.imagesRoot, ff, e.queue, e.library, e.responder(), e.originals, e.mgr.ItemLocks())
			w := e.do(e.t, h, http.MethodPost, fmt.Sprintf("/frame-match/queue/%d/accept", qid), "/frame-match/queue/:id/accept", "")
			_, gerr := e.queue.Get(context.Background(), qid)
			if w.Code == http.StatusOK && gerr == nil {
				e.t.Error("a successful accept must remove the queue row")
			}
			if w.Code != http.StatusOK && gerr != nil {
				e.t.Error("a failed accept must leave the queue row in place")
			}
			return w
		}},
		{name: "redownload", call: func(e *swEnv, data []byte, ff string) *httptest.ResponseRecorder {
			ytdlp := e.fakeYtDlp(data, ff, false)
			h := RedownloadLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, e.responder(), e.originals, e.mgr.ItemLocks())
			return e.do(e.t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/redownload", e.id), "/library/:id/thumbnail/redownload", "")
		}},
	}
}

func (e *swEnv) inject(mode writeMode) {
	e.t.Helper()
	oldR, oldU := thumbwrite.RenameFile, thumbwrite.UpdateRow
	e.t.Cleanup(func() { thumbwrite.RenameFile, thumbwrite.UpdateRow = oldR, oldU })
	switch mode {
	case modeDBFails:
		thumbwrite.UpdateRow = func(context.Context, *repository.LibraryRepo, int64, *string, *string, *string, *int, *int) error {
			return errors.New("db is down")
		}
	case modeRenameFails:
		thumbwrite.RenameFile = func(string, string) error { return errors.New("rename refused") }
	}
}

func TestThumbnailHandlersSuccess(t *testing.T) {
	for _, h := range swHandlers() {
		t.Run(h.name, func(t *testing.T) {
			e := newSWEnv(t)
			before := e.snapshot()
			w := h.call(e, e.newBytes, e.fakeFFmpeg(e.newBytes, false))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			if got, _ := os.ReadFile(e.thumbAbs); !bytes.Equal(got, e.newBytes) {
				t.Fatal("sidecar was not replaced")
			}
			after := e.snapshot()
			if after.thumb == nil || *after.thumb != "show/Video.jpg" || *after.w != 8 || *after.h != 8 {
				t.Errorf("row = %v %v %v", after.thumb, after.w, after.h)
			}
			for _, p := range []*string{after.small, after.medium} {
				if p == nil || strings.Contains(*p, "old.webp") || !exists(filepath.Join(e.imagesRoot, *p)) {
					t.Errorf("tier not replaced: %v", p)
				}
			}
			assertGone(t, e.oldSmall, e.oldMed)
			if hasThumbTemp(t, e.mediaRoot) {
				t.Error("temp file left behind")
			}
			if after.backupRow || after.backupFile {
				t.Error("the stale AI-enhancement backup must be removed after a successful write")
			}
			_ = before
		})
	}
}

func TestThumbnailHandlersFailuresChangeNothing(t *testing.T) {
	modes := map[string]writeMode{"garbage": modeGarbage, "tiers fail": modeTierFails, "db update fails": modeDBFails, "rename fails": modeRenameFails}
	for _, h := range swHandlers() {
		for name, mode := range modes {
			t.Run(h.name+"/"+name, func(t *testing.T) {
				e := newSWEnv(t)
				e.inject(mode)
				data := e.newBytes
				if mode == modeGarbage {
					data = []byte("definitely not an image")
				}
				ff := e.fakeFFmpeg(data, mode == modeTierFails)
				before := e.snapshot()
				w := h.call(e, data, ff)
				want := http.StatusInternalServerError
				if mode == modeGarbage && h.garbage400 {
					want = http.StatusBadRequest
				}
				if w.Code != want {
					t.Fatalf("status %d, want %d: %s", w.Code, want, w.Body)
				}
				if mode == modeGarbage && h.garbage400 && !strings.Contains(w.Body.String(), "the data is not a decodable image") {
					t.Errorf("body = %s", w.Body)
				}
				// Gallery/frame-match fixtures add files of their own under the images root; compare
				// everything the action could have touched.
				e.assertUnchanged(before)
				if hasThumbTemp(t, e.mediaRoot) {
					t.Error("temp file left behind")
				}
			})
		}
	}
}

// withoutFixtureFiles drops the input files the gallery / frame-match cases create themselves.
func withoutFixtureFiles(in []string) []string {
	var out []string
	for _, f := range in {
		if strings.HasPrefix(f, "thumbnail-gallery") || strings.HasPrefix(f, "frame-match") {
			continue
		}
		out = append(out, f)
	}
	return out
}

func TestThumbnailHandlersBusyItemAnswers409(t *testing.T) {
	for _, h := range swHandlers() {
		t.Run(h.name, func(t *testing.T) {
			e := newSWEnv(t)
			if !e.mgr.ItemLocks().TryLock(e.id) {
				t.Fatal("could not take the item lock")
			}
			defer e.mgr.ItemLocks().Unlock(e.id)
			before := e.snapshot()
			w := h.call(e, e.newBytes, e.fakeFFmpeg(e.newBytes, false))
			if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), itemBusyMessage) {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			e.assertUnchanged(before)
		})
	}
}

// The item lock is released after the swap, so the next request goes through.
func TestThumbnailHandlerReleasesTheItemLock(t *testing.T) {
	e := newSWEnv(t)
	h := swHandlers()[0]
	if w := h.call(e, e.newBytes, e.fakeFFmpeg(e.newBytes, false)); w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if !e.mgr.ItemLocks().TryLock(e.id) {
		t.Fatal("the item lock was not released")
	}
	e.mgr.ItemLocks().Unlock(e.id)
}

// An item with no thumbnail yet gets its row's thumbnail column set.
func TestSetThumbnailOnAnItemWithoutOne(t *testing.T) {
	e := newSWEnv(t)
	if _, err := e.conn.Exec(`UPDATE library SET thumbnail = NULL, thumbnail_small_path = NULL, thumbnail_medium_path = NULL, thumbnail_width = NULL, thumbnail_height = NULL WHERE id = ?`, e.id); err != nil {
		t.Fatal(err)
	}
	os.Remove(e.thumbAbs)
	w := swHandlers()[0].call(e, e.newBytes, e.fakeFFmpeg(e.newBytes, false))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	it, _ := e.library.Get(context.Background(), e.id)
	if it.Thumbnail == nil || *it.Thumbnail != "show/Video.jpg" || it.ThumbnailSmallPath == nil || *it.ThumbnailWidth != 8 {
		t.Fatalf("row = %+v", it)
	}
	if got, _ := os.ReadFile(e.thumbAbs); !bytes.Equal(got, e.newBytes) {
		t.Fatal("sidecar not written")
	}
}

// ---- redownload specifics ----

func scratchLeftovers(t *testing.T, mediaRoot string) []string {
	t.Helper()
	var out []string
	filepath.WalkDir(filepath.Join(mediaRoot, ".packrat-tmp"), func(p string, d os.DirEntry, err error) error {
		if err == nil && p != filepath.Join(mediaRoot, ".packrat-tmp") {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestRedownloadUsesAScratchDirectoryAndLeavesNothing(t *testing.T) {
	cases := map[string]struct {
		jpg      []byte
		ytFail   bool
		tierFail bool
		code     int
	}{
		"success":         {code: http.StatusOK},
		"yt-dlp fails":    {ytFail: true, code: http.StatusBadGateway},
		"not an image":    {jpg: []byte("garbage"), code: http.StatusInternalServerError},
		"tier generation": {tierFail: true, code: http.StatusInternalServerError},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			e := newSWEnv(t)
			jpg := tc.jpg
			if jpg == nil {
				jpg = e.newBytes
			}
			ytdlp := e.fakeYtDlp(jpg, e.fakeFFmpeg(e.newBytes, tc.tierFail), tc.ytFail)
			mediaBefore := withoutScratchRoot(mediaFiles(t, e.mediaRoot))
			before := e.snapshot()

			h := RedownloadLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, e.responder(), e.originals, e.mgr.ItemLocks())
			w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/redownload", e.id), "/library/:id/thumbnail/redownload", "")
			if w.Code != tc.code {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.code, w.Body)
			}
			if left := scratchLeftovers(t, e.mediaRoot); len(left) != 0 {
				t.Errorf("scratch files remain: %v", left)
			}
			for _, f := range mediaFiles(t, e.mediaRoot) {
				if strings.HasSuffix(f, ".webp") || strings.HasSuffix(f, ".part") {
					t.Errorf("yt-dlp leftover next to the media file: %s", f)
				}
			}
			if tc.code == http.StatusOK {
				if got, _ := os.ReadFile(e.thumbAbs); !bytes.Equal(got, e.newBytes) {
					t.Error("sidecar not replaced")
				}
				if now := withoutScratchRoot(mediaFiles(t, e.mediaRoot)); !reflect.DeepEqual(now, mediaBefore) {
					t.Errorf("media folder changed: %v -> %v", mediaBefore, now)
				}
				return
			}
			// Failure: the old sidecar and everything else is untouched (the shared scratch
			// root may have been created, which the listing excludes by being empty).
			e.assertUnchanged(before)
		})
	}
}

// yt-dlp never sees the sidecar's directory: the output template is under the scratch area.
func TestRedownloadFetchesOutsideTheMediaFolder(t *testing.T) {
	e := newSWEnv(t)
	logFile := filepath.Join(t.TempDir(), "args.log")
	ytdlp := e.fakeYtDlp(e.newBytes, e.fakeFFmpeg(e.newBytes, false), false)
	orig, _ := os.ReadFile(ytdlp.BinPath)
	wrapped := strings.Replace(string(orig), "base=", fmt.Sprintf("echo \"$out\" >> %q\nbase=", logFile), 1)
	if err := os.WriteFile(ytdlp.BinPath, []byte(wrapped), 0o755); err != nil {
		t.Fatal(err)
	}
	h := RedownloadLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.library, ytdlp, e.responder(), e.originals, e.mgr.ItemLocks())
	if w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/redownload", e.id), "/library/:id/thumbnail/redownload", ""); w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	out, _ := os.ReadFile(logFile)
	tmpRoot := filepath.Join(e.mediaRoot, ".packrat-tmp") + string(filepath.Separator)
	if !strings.HasPrefix(strings.TrimSpace(string(out)), tmpRoot) {
		t.Fatalf("yt-dlp output template = %q, want it under %s", strings.TrimSpace(string(out)), tmpRoot)
	}
}
