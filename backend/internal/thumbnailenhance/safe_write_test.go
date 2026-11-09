package thumbnailenhance

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// ---- migrated test database (built once per test binary, copied per test) ----

var (
	tmplOnce sync.Once
	tmplDir  string
	tmplPath string
	tmplErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if tmplDir != "" {
		os.RemoveAll(tmplDir)
	}
	os.Exit(code)
}

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	tmplOnce.Do(func() {
		tmplDir, tmplErr = os.MkdirTemp("", "packrat-enhance-template-")
		if tmplErr != nil {
			return
		}
		tmplPath = filepath.Join(tmplDir, "template.db")
		conn, err := db.Open(tmplPath)
		if err != nil {
			tmplErr = err
			return
		}
		defer conn.Close()
		if err := db.Migrate(conn, filepath.Join("..", "..", "..", "database", "migrations")); err != nil {
			tmplErr = err
			return
		}
		_, tmplErr = conn.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	})
	if tmplErr != nil {
		t.Fatalf("template db: %v", tmplErr)
	}
	dst := filepath.Join(t.TempDir(), "test.db")
	in, err := os.Open(tmplPath)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		t.Fatal(err)
	}
	out.Close()
	conn, err := db.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// ---- fixture ----

type fixture struct {
	t        *testing.T
	conn     *sql.DB
	deps     Deps
	itemID   int64
	thumbAbs string
	original []byte // the sidecar's bytes
	ffmpeg   string // fake ffmpeg path
	ffLog    string // file the fake ffmpeg appends its -i argument to
}

func pngBytes(t *testing.T, size int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for x := 0; x < size; x++ {
		for y := 0; y < size; y++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// fakeFFmpeg writes a shell script standing in for the tier encoder: it logs its -i input and
// creates every .webp output argument, or exits 1 when fail is set.
func fakeFFmpeg(t *testing.T, fail bool) (path, logPath string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fakes need a POSIX shell")
	}
	dir := t.TempDir()
	logPath = filepath.Join(dir, "inputs.log")
	body := "#!/bin/sh\n"
	if fail {
		body += "echo 'encoder exploded' >&2\nexit 1\n"
	} else {
		body += fmt.Sprintf(`prev=""
for a in "$@"; do
  if [ "$prev" = "-i" ]; then echo "$a" >> %q; fi
  case "$a" in *.webp) printf webp > "$a" ;; esac
  prev="$a"
done
`, logPath)
	}
	path = filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path, logPath
}

func newFixture(t *testing.T, failFFmpeg bool) *fixture {
	t.Helper()
	conn := openTestDB(t)
	root := t.TempDir()
	mediaRoot := filepath.Join(root, "media")
	imagesRoot := filepath.Join(root, "images")
	if err := os.MkdirAll(filepath.Join(mediaRoot, "show"), 0o755); err != nil {
		t.Fatal(err)
	}
	ff, ffLog := fakeFFmpeg(t, failFFmpeg)
	deps := Deps{
		SettingsRepo:  repository.NewSettingsRepo(conn),
		LibraryRepo:   repository.NewLibraryRepo(conn),
		HistoryRepo:   repository.NewThumbnailEnhancementHistoryRepo(conn),
		OriginalsRepo: repository.NewThumbnailEnhancementOriginalsRepo(conn),
		MediaRoot:     mediaRoot,
		ImagesRoot:    imagesRoot,
		FFmpegPath:    ff,
	}
	f := &fixture{t: t, conn: conn, deps: deps, ffmpeg: ff, ffLog: ffLog}

	f.original = pngBytes(t, 4, color.RGBA{R: 200, A: 255})
	f.thumbAbs = filepath.Join(mediaRoot, "show", "Video.png")
	if err := os.WriteFile(f.thumbAbs, f.original, 0o640); err != nil {
		t.Fatal(err)
	}
	mt, thumb, status := "video", "show/Video.png", "available"
	id, err := deps.LibraryRepo.Create(context.Background(), &models.LibraryItem{
		Title: "Video", Filename: "Video.mp4", Path: "show/Video.mp4", MediaType: &mt, Thumbnail: &thumb, Status: status,
	})
	if err != nil {
		t.Fatal(err)
	}
	f.itemID = id

	// Old derivatives the database points at.
	small := fmt.Sprintf("library/%d/small/old.webp", id)
	medium := fmt.Sprintf("library/%d/medium/old.webp", id)
	for _, rel := range []string{small, medium} {
		abs := filepath.Join(imagesRoot, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(abs), 0o755)
		if err := os.WriteFile(abs, []byte("old-"+rel), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	w, h := 4, 4
	if err := deps.LibraryRepo.UpdateThumbnailTiers(context.Background(), id, &small, &medium, &w, &h); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) upscaler(body []byte) *Client {
	f.t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"image": base64.StdEncoding.EncodeToString(body)})
	}))
	f.t.Cleanup(srv.Close)
	return NewClient(srv.URL, "", "")
}

func (f *fixture) item() *models.LibraryItem {
	f.t.Helper()
	it, err := f.deps.LibraryRepo.Get(context.Background(), f.itemID)
	if err != nil {
		f.t.Fatal(err)
	}
	return it
}

func (f *fixture) run(client *Client, autoApprove bool) error {
	f.t.Helper()
	it := f.item()
	cfg := config{minDim: 720, factor: 4, targetMode: "factor", autoApprove: autoApprove, upscaler: "u"}
	return enhanceOne(context.Background(), f.deps, client, cfg, *it, f.thumbAbs, 4, 4, int64(len(f.original)), "manual", modeUpscale)
}

// files lists every regular file under dir (sorted, slash-relative).
func files(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			rel, _ := filepath.Rel(dir, p)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(out)
	return out
}

func (f *fixture) historyStatuses() []string {
	f.t.Helper()
	rows, err := f.conn.Query(`SELECT status FROM thumbnail_enhancement_history ORDER BY id`)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		out = append(out, s)
	}
	return out
}

func (f *fixture) backupRows() int {
	var n int
	f.conn.QueryRow(`SELECT COUNT(*) FROM thumbnail_enhancement_originals`).Scan(&n)
	return n
}

// state is everything a failed run must leave exactly as it was.
type state struct {
	sidecar     []byte
	small, med  *string
	w, h        *int
	mediaFiles  []string
	imagesFiles []string
}

func (f *fixture) snapshot() state {
	it := f.item()
	b, err := os.ReadFile(f.thumbAbs)
	if err != nil {
		f.t.Fatal(err)
	}
	return state{b, it.ThumbnailSmallPath, it.ThumbnailMediumPath, it.ThumbnailWidth, it.ThumbnailHeight,
		files(f.t, f.deps.MediaRoot), files(f.t, f.deps.ImagesRoot)}
}

func (f *fixture) assertUnchanged(before state) {
	f.t.Helper()
	after := f.snapshot()
	if !bytes.Equal(before.sidecar, after.sidecar) {
		f.t.Error("sidecar bytes changed")
	}
	if !reflect.DeepEqual(before.small, after.small) || !reflect.DeepEqual(before.med, after.med) ||
		!reflect.DeepEqual(before.w, after.w) || !reflect.DeepEqual(before.h, after.h) {
		f.t.Errorf("library row changed: %v/%v/%v/%v -> %v/%v/%v/%v", before.small, before.med, before.w, before.h, after.small, after.med, after.w, after.h)
	}
	// Same file set: old derivatives still there, no temp file, no orphaned new tier, no backup.
	if !reflect.DeepEqual(before.mediaFiles, after.mediaFiles) {
		f.t.Errorf("media files changed: %v -> %v", before.mediaFiles, after.mediaFiles)
	}
	if !reflect.DeepEqual(before.imagesFiles, after.imagesFiles) {
		f.t.Errorf("image files changed: %v -> %v", before.imagesFiles, after.imagesFiles)
	}
}

func hasTemp(names []string) bool {
	for _, n := range names {
		if fsutil.IsThumbTmpName(filepath.Base(n)) {
			return true
		}
	}
	return false
}

// ---- success ----

func TestEnhanceOneSuccessReplacesSidecarAndTiers(t *testing.T) {
	f := newFixture(t, false)
	before := f.snapshot()
	enhanced := pngBytes(t, 8, color.RGBA{G: 200, A: 255})

	if err := f.run(f.upscaler(enhanced), false); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, enhanced) {
		t.Fatal("sidecar was not replaced with the enhanced image")
	}
	if info, _ := os.Stat(f.thumbAbs); info.Mode().Perm() != 0o640 {
		t.Errorf("sidecar permissions = %v, want the old 0640 kept", info.Mode().Perm())
	}
	it := f.item()
	if it.ThumbnailWidth == nil || *it.ThumbnailWidth != 8 || *it.ThumbnailHeight != 8 {
		t.Errorf("dimensions = %v x %v, want 8x8", it.ThumbnailWidth, it.ThumbnailHeight)
	}
	for _, p := range []*string{it.ThumbnailSmallPath, it.ThumbnailMediumPath} {
		if p == nil || strings.Contains(*p, "old.webp") {
			t.Fatalf("tier not replaced: %v", p)
		}
		if _, err := os.Stat(filepath.Join(f.deps.ImagesRoot, filepath.FromSlash(*p))); err != nil {
			t.Errorf("new tier missing: %v", err)
		}
	}
	for _, old := range []*string{before.small, before.med} {
		if _, err := os.Stat(filepath.Join(f.deps.ImagesRoot, filepath.FromSlash(*old))); !os.IsNotExist(err) {
			t.Errorf("old derivative %s should be deleted", *old)
		}
	}
	if hasTemp(files(t, f.deps.MediaRoot)) {
		t.Error("temp file left behind")
	}
	if !reflect.DeepEqual(f.historyStatuses(), []string{"success"}) || f.backupRows() != 1 {
		t.Errorf("history = %v, backups = %d", f.historyStatuses(), f.backupRows())
	}
	// The tiers were generated from the temp copy, not from the sidecar.
	in, _ := os.ReadFile(f.ffLog)
	if !strings.Contains(string(in), fsutil.ThumbTmpPrefix) {
		t.Errorf("tiers were generated from %q, want the temp file", strings.TrimSpace(string(in)))
	}
}

// ---- failure injection ----

func TestEnhanceOneFailuresLeaveEverythingUntouched(t *testing.T) {
	good := pngBytes(t, 8, color.RGBA{G: 200, A: 255})
	cases := []struct {
		name       string
		failFFmpeg bool
		upscaled   []byte
		hook       func(t *testing.T)
	}{
		{name: "upscaler returns bytes that are not an image", upscaled: []byte("definitely not an image")},
		{name: "tier generation fails", failFFmpeg: true, upscaled: good},
		{name: "UpdateThumbnailTiers fails", upscaled: good, hook: func(t *testing.T) {
			old := updateTiers
			updateTiers = func(context.Context, *repository.LibraryRepo, int64, *string, *string, *int, *int) error {
				return errors.New("db is down")
			}
			t.Cleanup(func() { updateTiers = old })
		}},
		{name: "the final rename fails", upscaled: good, hook: func(t *testing.T) {
			old := renameFile
			renameFile = func(string, string) error { return errors.New("rename refused") }
			t.Cleanup(func() { renameFile = old })
		}},
	}
	for _, tc := range cases {
		for _, autoApprove := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/autoApprove=%v", tc.name, autoApprove), func(t *testing.T) {
				f := newFixture(t, tc.failFFmpeg)
				if tc.hook != nil {
					tc.hook(t)
				}
				before := f.snapshot()
				if err := f.run(f.upscaler(tc.upscaled), autoApprove); err == nil {
					t.Fatal("want an error")
				}
				f.assertUnchanged(before)
				if hasTemp(files(t, f.deps.MediaRoot)) {
					t.Error("temp file left behind")
				}
				if !reflect.DeepEqual(f.historyStatuses(), []string{"failed"}) {
					t.Errorf("history = %v, want one failed row", f.historyStatuses())
				}
				if n := f.backupRows(); n != 0 {
					t.Errorf("%d backup row(s) left behind", n)
				}
			})
		}
	}
}

// A failed run must not delete a backup from an EARLIER successful enhancement.
func TestEnhanceOneFailureKeepsAnEarlierBackup(t *testing.T) {
	f := newFixture(t, false)
	if err := f.run(f.upscaler(pngBytes(t, 8, color.RGBA{G: 200, A: 255})), false); err != nil {
		t.Fatal(err)
	}
	backupBefore, err := f.deps.OriginalsRepo.Get(context.Background(), f.itemID)
	if err != nil {
		t.Fatal(err)
	}
	before := f.snapshot()
	if err := f.run(f.upscaler([]byte("garbage")), false); err == nil {
		t.Fatal("want an error")
	}
	f.assertUnchanged(before)
	if got, err := f.deps.OriginalsRepo.Get(context.Background(), f.itemID); err != nil || got != backupBefore {
		t.Fatalf("earlier backup = %q, %v; want %q kept", got, err, backupBefore)
	}
}

// If putting the row back after a failed rename itself fails, the new tiers stay (the row
// points at them) rather than leaving the row dangling.
func TestWriteThumbnailFileRenameFailureThenRestoreFailureKeepsNewTiers(t *testing.T) {
	f := newFixture(t, false)
	oldRename, oldUpdate := renameFile, updateTiers
	t.Cleanup(func() { renameFile, updateTiers = oldRename, oldUpdate })
	renameFile = func(string, string) error { return errors.New("rename refused") }
	calls := 0
	updateTiers = func(ctx context.Context, r *repository.LibraryRepo, id int64, s, m *string, w, h *int) error {
		calls++
		if calls == 2 {
			return errors.New("restore failed")
		}
		return r.UpdateThumbnailTiers(ctx, id, s, m, w, h)
	}
	_, _, _, err := writeThumbnailFile(context.Background(), f.deps, f.itemID, f.thumbAbs, pngBytes(t, 8, color.RGBA{B: 200, A: 255}))
	if err == nil {
		t.Fatal("want an error")
	}
	it := f.item()
	for _, p := range []*string{it.ThumbnailSmallPath, it.ThumbnailMediumPath} {
		if _, serr := os.Stat(filepath.Join(f.deps.ImagesRoot, filepath.FromSlash(*p))); serr != nil {
			t.Errorf("the row points at %s but it is gone: %v", *p, serr)
		}
	}
}

// ---- revert ----

func TestRevertGoesThroughTheSafePath(t *testing.T) {
	f := newFixture(t, false)
	enhanced := pngBytes(t, 8, color.RGBA{G: 200, A: 255})
	if err := f.run(f.upscaler(enhanced), false); err != nil {
		t.Fatal(err)
	}

	t.Run("a failing step leaves the enhanced sidecar and row as they were", func(t *testing.T) {
		old := renameFile
		renameFile = func(string, string) error { return errors.New("rename refused") }
		defer func() { renameFile = old }()
		before := f.snapshot()
		if err := RevertOriginal(context.Background(), f.deps, f.itemID); err == nil {
			t.Fatal("want an error")
		}
		f.assertUnchanged(before)
		if f.backupRows() != 1 {
			t.Error("the backup must survive a failed revert")
		}
	})

	t.Run("success restores the original and removes the backup", func(t *testing.T) {
		if err := RevertOriginal(context.Background(), f.deps, f.itemID); err != nil {
			t.Fatal(err)
		}
		got, _ := os.ReadFile(f.thumbAbs)
		if !bytes.Equal(got, f.original) {
			t.Error("sidecar is not the original again")
		}
		if it := f.item(); *it.ThumbnailWidth != 4 {
			t.Errorf("width = %d, want 4", *it.ThumbnailWidth)
		}
		if f.backupRows() != 0 || hasTemp(files(t, f.deps.MediaRoot)) {
			t.Error("backup row or temp file left behind")
		}
	})
}
