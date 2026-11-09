package thumbwrite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"io/fs"
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
		tmplDir, tmplErr = os.MkdirTemp("", "packrat-thumbwrite-template-")
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

// fakeFFmpeg stands in for the tier encoder: it logs its -i input and creates every .webp
// output argument, or exits 1 when fail is set.
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

type fixture struct {
	t          *testing.T
	repo       *repository.LibraryRepo
	mediaRoot  string
	imagesRoot string
	ffmpeg     string
	ffLog      string
	id         int64
	thumbAbs   string
	thumbRel   string
	original   []byte
}

// newFixture creates an item with a media file; withThumb also gives it a sidecar and old tiers.
func newFixture(t *testing.T, failFFmpeg, withThumb bool) *fixture {
	t.Helper()
	conn := openTestDB(t)
	root := t.TempDir()
	f := &fixture{t: t, repo: repository.NewLibraryRepo(conn), mediaRoot: filepath.Join(root, "media"), imagesRoot: filepath.Join(root, "images"),
		thumbRel: "show/Video.jpg"}
	if err := os.MkdirAll(filepath.Join(f.mediaRoot, "show"), 0o755); err != nil {
		t.Fatal(err)
	}
	f.ffmpeg, f.ffLog = fakeFFmpeg(t, failFFmpeg)
	f.thumbAbs = filepath.Join(f.mediaRoot, "show", "Video.jpg")
	mt := "video"
	item := &models.LibraryItem{Title: "Video", Filename: "Video.mp4", Path: "show/Video.mp4", MediaType: &mt, Status: "available"}
	if withThumb {
		item.Thumbnail = &f.thumbRel
		f.original = pngBytes(t, 4, color.RGBA{R: 200, A: 255})
		if err := os.WriteFile(f.thumbAbs, f.original, 0o640); err != nil {
			t.Fatal(err)
		}
	}
	id, err := f.repo.Create(context.Background(), item)
	if err != nil {
		t.Fatal(err)
	}
	f.id = id
	if withThumb {
		small := fmt.Sprintf("library/%d/small/old.webp", id)
		medium := fmt.Sprintf("library/%d/medium/old.webp", id)
		for _, rel := range []string{small, medium} {
			abs := filepath.Join(f.imagesRoot, filepath.FromSlash(rel))
			os.MkdirAll(filepath.Dir(abs), 0o755)
			if err := os.WriteFile(abs, []byte("old-"+rel), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		w, h := 4, 4
		if err := f.repo.UpdateThumbnailTiers(context.Background(), id, &small, &medium, &w, &h); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f *fixture) params(data []byte) Params {
	return Params{Repo: f.repo, FFmpegPath: f.ffmpeg, ImagesRoot: f.imagesRoot, ID: f.id, ThumbAbs: f.thumbAbs, ThumbRel: &f.thumbRel, Data: data}
}

func (f *fixture) item() *models.LibraryItem {
	f.t.Helper()
	it, err := f.repo.Get(context.Background(), f.id)
	if err != nil {
		f.t.Fatal(err)
	}
	return it
}

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

func hasTemp(names []string) bool {
	for _, n := range names {
		if fsutil.IsThumbTmpName(filepath.Base(n)) {
			return true
		}
	}
	return false
}

type snap struct {
	sidecar []byte // nil when absent
	item    models.LibraryItem
	media   []string
	images  []string
}

func (f *fixture) snapshot() snap {
	b, _ := os.ReadFile(f.thumbAbs)
	return snap{b, *f.item(), files(f.t, f.mediaRoot), files(f.t, f.imagesRoot)}
}

func (f *fixture) assertUnchanged(before snap) {
	f.t.Helper()
	after := f.snapshot()
	if !bytes.Equal(before.sidecar, after.sidecar) {
		f.t.Error("sidecar bytes changed")
	}
	if !reflect.DeepEqual(before.item, after.item) {
		f.t.Errorf("library row changed: %+v -> %+v", before.item, after.item)
	}
	if !reflect.DeepEqual(before.media, after.media) {
		f.t.Errorf("media files changed: %v -> %v", before.media, after.media)
	}
	if !reflect.DeepEqual(before.images, after.images) {
		f.t.Errorf("image files changed: %v -> %v", before.images, after.images)
	}
}

func setHooks(t *testing.T, rename func(string, string) error, update func(calls int) error) *int {
	t.Helper()
	oldR, oldU := RenameFile, UpdateRow
	t.Cleanup(func() { RenameFile, UpdateRow = oldR, oldU })
	calls := new(int)
	if rename != nil {
		RenameFile = rename
	}
	UpdateRow = func(ctx context.Context, r *repository.LibraryRepo, id int64, th, s, m *string, w, h *int) error {
		*calls++
		if update != nil {
			if err := update(*calls); err != nil {
				return err
			}
		}
		return oldU(ctx, r, id, th, s, m, w, h)
	}
	return calls
}

func TestReplaceSuccess(t *testing.T) {
	f := newFixture(t, false, true)
	before := f.snapshot()
	calls := setHooks(t, nil, nil)
	data := pngBytes(t, 8, color.RGBA{G: 200, A: 255})

	res, err := Replace(context.Background(), f.params(data))
	if err != nil {
		t.Fatal(err)
	}
	if res.Width != 8 || res.Height != 8 || res.Size != int64(len(data)) {
		t.Errorf("result = %+v", res)
	}
	if got, _ := os.ReadFile(f.thumbAbs); !bytes.Equal(got, data) {
		t.Fatal("sidecar was not replaced")
	}
	if info, _ := os.Stat(f.thumbAbs); info.Mode().Perm() != 0o640 {
		t.Errorf("permissions = %v, want the old 0640 kept", info.Mode().Perm())
	}
	if *calls != 1 {
		t.Errorf("database update ran %d times, want exactly 1 statement", *calls)
	}
	it := f.item()
	if it.Thumbnail == nil || *it.Thumbnail != f.thumbRel || *it.ThumbnailWidth != 8 || *it.ThumbnailHeight != 8 {
		t.Errorf("row = %v %v %v", it.Thumbnail, it.ThumbnailWidth, it.ThumbnailHeight)
	}
	for _, p := range []*string{it.ThumbnailSmallPath, it.ThumbnailMediumPath} {
		if p == nil || strings.Contains(*p, "old.webp") {
			t.Fatalf("tier not replaced: %v", p)
		}
		if _, err := os.Stat(filepath.Join(f.imagesRoot, *p)); err != nil {
			t.Errorf("new tier missing: %v", err)
		}
	}
	for _, old := range []*string{before.item.ThumbnailSmallPath, before.item.ThumbnailMediumPath} {
		if _, err := os.Stat(filepath.Join(f.imagesRoot, *old)); !os.IsNotExist(err) {
			t.Errorf("old derivative %s should be deleted", *old)
		}
	}
	if hasTemp(files(t, f.mediaRoot)) {
		t.Error("temp file left behind")
	}
	in, _ := os.ReadFile(f.ffLog)
	if !strings.Contains(string(in), fsutil.ThumbTmpPrefix) {
		t.Errorf("tiers were generated from %q, want the temp file", strings.TrimSpace(string(in)))
	}
}

func TestReplaceItemWithoutThumbnailGetsThePathSet(t *testing.T) {
	f := newFixture(t, false, false)
	if f.item().Thumbnail != nil {
		t.Fatal("fixture should start without a thumbnail")
	}
	data := pngBytes(t, 6, color.RGBA{B: 200, A: 255})
	if _, err := Replace(context.Background(), f.params(data)); err != nil {
		t.Fatal(err)
	}
	it := f.item()
	if it.Thumbnail == nil || *it.Thumbnail != f.thumbRel {
		t.Fatalf("thumbnail = %v, want %q", it.Thumbnail, f.thumbRel)
	}
	if info, err := os.Stat(f.thumbAbs); err != nil || info.Mode().Perm() != 0o644 {
		t.Errorf("new sidecar: %v %v, want 0644", info, err)
	}
	if it.ThumbnailSmallPath == nil || *it.ThumbnailWidth != 6 {
		t.Errorf("tiers/dimensions not set: %v %v", it.ThumbnailSmallPath, it.ThumbnailWidth)
	}
}

func TestReplaceNilThumbRelKeepsTheRowPath(t *testing.T) {
	f := newFixture(t, false, true)
	p := f.params(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))
	p.ThumbRel = nil
	if _, err := Replace(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if it := f.item(); it.Thumbnail == nil || *it.Thumbnail != f.thumbRel {
		t.Fatalf("thumbnail = %v, want %q kept", it.Thumbnail, f.thumbRel)
	}
}

func TestReplaceFailuresLeaveEverythingUntouched(t *testing.T) {
	good := pngBytes(t, 8, color.RGBA{G: 200, A: 255})
	cases := []struct {
		name       string
		failFFmpeg bool
		data       []byte
		rename     func(string, string) error
		update     func(int) error
		notAnImage bool
	}{
		{name: "not an image", data: []byte("definitely not an image"), notAnImage: true},
		{name: "empty data", data: nil, notAnImage: true},
		{name: "tier generation fails", failFFmpeg: true, data: good},
		{name: "database update fails", data: good, update: func(int) error { return errors.New("db is down") }},
		{name: "rename fails", data: good, rename: func(string, string) error { return errors.New("rename refused") }},
	}
	for _, withThumb := range []bool{true, false} {
		for _, tc := range cases {
			t.Run(fmt.Sprintf("%s/hadThumbnail=%v", tc.name, withThumb), func(t *testing.T) {
				f := newFixture(t, tc.failFFmpeg, withThumb)
				setHooks(t, tc.rename, tc.update)
				before := f.snapshot()
				_, err := Replace(context.Background(), f.params(tc.data))
				if err == nil {
					t.Fatal("want an error")
				}
				if errors.Is(err, ErrNotAnImage) != tc.notAnImage {
					t.Errorf("errors.Is(err, ErrNotAnImage) = %v for %v", !tc.notAnImage, err)
				}
				f.assertUnchanged(before)
				if hasTemp(files(t, f.mediaRoot)) {
					t.Error("temp file left behind")
				}
			})
		}
	}
}

// A failed rename puts thumbnail path, tiers and dimensions back.
func TestReplaceRenameFailureRestoresPathTiersAndDimensions(t *testing.T) {
	f := newFixture(t, false, true)
	// Point the row at a different recorded path so a restore that forgets it is caught.
	other := "show/Other.jpg"
	small, medium := *f.item().ThumbnailSmallPath, *f.item().ThumbnailMediumPath
	w, h := 4, 4
	if err := f.repo.UpdateThumbnailAndTiers(context.Background(), f.id, &other, &small, &medium, &w, &h); err != nil {
		t.Fatal(err)
	}
	before := f.snapshot()
	calls := setHooks(t, func(string, string) error { return errors.New("rename refused") }, nil)
	if _, err := Replace(context.Background(), f.params(pngBytes(t, 8, color.RGBA{G: 200, A: 255}))); err == nil {
		t.Fatal("want an error")
	}
	if *calls != 2 {
		t.Errorf("database update ran %d times, want the update and the restore", *calls)
	}
	f.assertUnchanged(before)
	if it := f.item(); *it.Thumbnail != other {
		t.Errorf("thumbnail = %q, want %q restored", *it.Thumbnail, other)
	}
}

// If putting the row back after a failed rename itself fails, the new tiers stay (the row
// points at them) rather than leaving the row dangling.
func TestReplaceRenameFailureThenRestoreFailureKeepsNewTiers(t *testing.T) {
	f := newFixture(t, false, true)
	setHooks(t, func(string, string) error { return errors.New("rename refused") },
		func(call int) error {
			if call == 2 {
				return errors.New("restore failed")
			}
			return nil
		})
	if _, err := Replace(context.Background(), f.params(pngBytes(t, 8, color.RGBA{B: 200, A: 255}))); err == nil {
		t.Fatal("want an error")
	}
	it := f.item()
	for _, p := range []*string{it.ThumbnailSmallPath, it.ThumbnailMediumPath} {
		if _, serr := os.Stat(filepath.Join(f.imagesRoot, filepath.FromSlash(*p))); serr != nil {
			t.Errorf("the row points at %s but it is gone: %v", *p, serr)
		}
	}
}

func TestUpdateThumbnailAndTiersIsOneStatement(t *testing.T) {
	f := newFixture(t, false, false)
	th, s, m, w, h := "a/b.jpg", "s.webp", "m.webp", 10, 20
	if err := f.repo.UpdateThumbnailAndTiers(context.Background(), f.id, &th, &s, &m, &w, &h); err != nil {
		t.Fatal(err)
	}
	it := f.item()
	if *it.Thumbnail != th || *it.ThumbnailSmallPath != s || *it.ThumbnailMediumPath != m || *it.ThumbnailWidth != 10 || *it.ThumbnailHeight != 20 {
		t.Fatalf("row = %+v", it)
	}
	if err := f.repo.UpdateThumbnailAndTiers(context.Background(), f.id, nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	it = f.item()
	if it.Thumbnail != nil || it.ThumbnailSmallPath != nil || it.ThumbnailWidth != nil {
		t.Fatalf("nil must clear every column: %+v", it)
	}
	if err := f.repo.UpdateThumbnailAndTiers(context.Background(), 999999, &th, &s, &m, &w, &h); err == nil {
		t.Error("an unknown id must fail")
	}
}
