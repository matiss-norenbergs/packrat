package imageproc

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

var (
	smallMediumTiers = []Tier{
		{Name: "small", MaxWidth: ThumbnailSmallWidth},
		{Name: "medium", MaxWidth: ThumbnailMediumWidth},
	}
	coverTiers = []Tier{
		{Name: "small", MaxWidth: ThumbnailSmallWidth},
		{Name: "medium", MaxWidth: ThumbnailMediumWidth},
		{Name: "original", MaxWidth: CoverOriginalWidth},
	}
)

// legacyGenerateTiersFromPath is the pre-single-pass implementation (one
// ffmpeg invocation per tier), kept as the reference for equivalence tests
// and the old-vs-new benchmark.
func legacyGenerateTiersFromPath(ctx context.Context, ffmpegPath, imagesRoot, kind string, entityID int64, srcAbs string, tiers []Tier) ([]string, error) {
	uid := uuid.NewString()
	paths := make([]string, len(tiers))
	for i, tier := range tiers {
		destDir := filepath.Join(imagesRoot, kind, strconv.FormatInt(entityID, 10), tier.Name)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, err
		}
		destAbs := filepath.Join(destDir, uid+".webp")
		if err := GenerateWebP(ctx, ffmpegPath, srcAbs, destAbs, tier.MaxWidth); err != nil {
			return nil, err
		}
		rel, _ := filepath.Rel(imagesRoot, destAbs)
		paths[i] = filepath.ToSlash(rel)
	}
	return paths, nil
}

func requireFFmpeg(tb testing.TB) string {
	tb.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		tb.Skip("ffmpeg not on PATH")
	}
	return p
}

// makeSource renders a noisy test image of the given size with ffmpeg lavfi.
func makeSource(tb testing.TB, ffmpeg, dst string, w, h, noise int) {
	tb.Helper()
	src := fmt.Sprintf("color=c=0x3060a0:s=%dx%d,noise=alls=%d:allf=u", w, h, noise)
	args := []string{"-y", "-f", "lavfi", "-i", src, "-frames:v", "1"}
	if filepath.Ext(dst) == ".jpg" {
		args = append(args, "-q:v", "3")
	}
	args = append(args, dst)
	if out, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
		tb.Fatalf("generating %s: %v: %s", dst, err, out)
	}
}

// webpDims reads width/height from a WebP file's header (lossy VP8, lossless
// VP8L or extended VP8X) - x/image/webp isn't a dependency of this module.
func webpDims(tb testing.TB, path string) (int, int) {
	tb.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		tb.Fatal(err)
	}
	if len(b) < 30 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		tb.Fatalf("%s is not a RIFF/WEBP file", path)
	}
	switch string(b[12:16]) {
	case "VP8 ":
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
	case "VP8L":
		v := binary.LittleEndian.Uint32(b[21:25])
		return int(v&0x3fff) + 1, int((v>>14)&0x3fff) + 1
	case "VP8X":
		w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
		h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
		return w + 1, h + 1
	}
	tb.Fatalf("%s: unknown WebP chunk %q", path, b[12:16])
	return 0, 0
}

func BenchmarkTiers(b *testing.B) {
	ffmpeg := requireFFmpeg(b)
	dir := b.TempDir()
	sources := []struct {
		name  string
		w, h  int
		ext   string
		noise int
	}{
		{"jpeg1280x720", 1280, 720, ".jpg", 40},
		{"jpeg1920x1080", 1920, 1080, ".jpg", 40},
		{"jpeg4000x3000", 4000, 3000, ".jpg", 40},
		{"png3000x2000", 3000, 2000, ".png", 100},
	}
	tierSets := []struct {
		name  string
		tiers []Tier
	}{{"2tier", smallMediumTiers}, {"3tier", coverTiers}}
	impls := []struct {
		name string
		fn   func(context.Context, string, string, string, int64, string, []Tier) ([]string, error)
	}{{"old", legacyGenerateTiersFromPath}, {"new", GenerateTiersFromPath}}

	for _, s := range sources {
		src := filepath.Join(dir, s.name+s.ext)
		makeSource(b, ffmpeg, src, s.w, s.h, s.noise)
		if fi, err := os.Stat(src); err == nil {
			b.Logf("source %s: %d bytes", s.name, fi.Size())
		}
		for _, ts := range tierSets {
			for _, impl := range impls {
				b.Run(s.name+"/"+ts.name+"/"+impl.name, func(b *testing.B) {
					root := b.TempDir()
					for i := 0; i < b.N; i++ {
						if _, err := impl.fn(context.Background(), ffmpeg, root, "library", 1, src, ts.tiers); err != nil {
							b.Fatal(err)
						}
					}
				})
			}
		}
	}
}

func walkWebP(tb testing.TB, root string) []string {
	tb.Helper()
	var out []string
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestGenerateTiersMatchesLegacy(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	dir := t.TempDir()
	cases := []struct {
		name string
		w, h int
		ext  string
	}{
		{"larger-than-all", 2400, 1350, ".jpg"},
		{"between-tiers", 600, 400, ".jpg"},
		{"smaller-than-all", 200, 100, ".jpg"},
		{"png", 1000, 500, ".png"},
	}
	for _, tc := range cases {
		for _, ts := range [][]Tier{smallMediumTiers, coverTiers, {{Name: "image", MaxWidth: ArtistImageWidth}}} {
			t.Run(fmt.Sprintf("%s/%dtier", tc.name, len(ts)), func(t *testing.T) {
				src := filepath.Join(dir, tc.name+tc.ext)
				if _, err := os.Stat(src); err != nil {
					makeSource(t, ffmpeg, src, tc.w, tc.h, 30)
				}
				oldRoot, newRoot := t.TempDir(), t.TempDir()
				ctx := context.Background()
				oldPaths, err := legacyGenerateTiersFromPath(ctx, ffmpeg, oldRoot, "library", 7, src, ts)
				if err != nil {
					t.Fatal(err)
				}
				newPaths, err := GenerateTiersFromPath(ctx, ffmpeg, newRoot, "library", 7, src, ts)
				if err != nil {
					t.Fatal(err)
				}
				if len(newPaths) != len(ts) {
					t.Fatalf("got %d paths, want %d", len(newPaths), len(ts))
				}
				for i, tier := range ts {
					wantW := tc.w
					if tier.MaxWidth < wantW {
						wantW = tier.MaxWidth
					}
					gw, gh := webpDims(t, filepath.Join(newRoot, filepath.FromSlash(newPaths[i])))
					ow, oh := webpDims(t, filepath.Join(oldRoot, filepath.FromSlash(oldPaths[i])))
					if gw != wantW {
						t.Errorf("tier %s: width %d, want %d (never upscale, cap at %d)", tier.Name, gw, wantW, tier.MaxWidth)
					}
					if gw != ow || gh != oh {
						t.Errorf("tier %s: new %dx%d != legacy %dx%d", tier.Name, gw, gh, ow, oh)
					}
					prefix := "library/7/" + tier.Name + "/"
					if len(newPaths[i]) < len(prefix) || newPaths[i][:len(prefix)] != prefix || filepath.Ext(newPaths[i]) != ".webp" {
						t.Errorf("tier %s: path %q does not follow %s<uuid>.webp", tier.Name, newPaths[i], prefix)
					}
					ob, _ := os.ReadFile(filepath.Join(oldRoot, filepath.FromSlash(oldPaths[i])))
					nb, _ := os.ReadFile(filepath.Join(newRoot, filepath.FromSlash(newPaths[i])))
					if string(ob) != string(nb) {
						t.Errorf("tier %s: bytes differ from legacy output (%d vs %d)", tier.Name, len(nb), len(ob))
					}
				}
			})
		}
	}
}

func TestGenerateTiersPreservesTierOrderAndSharedUID(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	src := filepath.Join(t.TempDir(), "s.jpg")
	makeSource(t, ffmpeg, src, 1600, 900, 30)
	tiers := []Tier{{Name: "original", MaxWidth: 1000}, {Name: "small", MaxWidth: 100}, {Name: "medium", MaxWidth: 500}}
	root := t.TempDir()
	paths, err := GenerateTiersFromPath(context.Background(), ffmpeg, root, "collections", 3, src, tiers)
	if err != nil {
		t.Fatal(err)
	}
	var uid string
	for i, tier := range tiers {
		dir, file := filepath.Split(filepath.FromSlash(paths[i]))
		if want := filepath.Join("collections", "3", tier.Name) + string(filepath.Separator); dir != want {
			t.Errorf("paths[%d] dir = %q, want %q", i, dir, want)
		}
		if i == 0 {
			uid = file
		} else if file != uid {
			t.Errorf("paths[%d] file %q differs from %q: tiers must share one uuid", i, file, uid)
		}
		if w, _ := webpDims(t, filepath.Join(root, filepath.FromSlash(paths[i]))); w != tier.MaxWidth {
			t.Errorf("tier %s width = %d, want %d", tier.Name, w, tier.MaxWidth)
		}
	}
}

func TestGenerateTiersFailureLeavesNoFiles(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	dir := t.TempDir()
	garbage := filepath.Join(dir, "garbage.jpg")
	os.WriteFile(garbage, []byte("definitely not an image"), 0o644)

	for name, src := range map[string]string{"garbage": garbage, "missing": filepath.Join(dir, "nope.jpg")} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			paths, err := GenerateTiersFromPath(context.Background(), ffmpeg, root, "library", 1, src, coverTiers)
			if err == nil {
				t.Fatalf("expected error, got paths %v", paths)
			}
			if paths != nil {
				t.Errorf("paths = %v, want nil on error", paths)
			}
			if files := walkWebP(t, root); len(files) != 0 {
				t.Errorf("files left behind after failure: %v", files)
			}
		})
	}
}

func TestGenerateTiersCancelledContextLeavesNoFiles(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	src := filepath.Join(t.TempDir(), "s.jpg")
	makeSource(t, ffmpeg, src, 800, 600, 30)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	root := t.TempDir()
	if _, err := GenerateTiersFromPath(ctx, ffmpeg, root, "library", 1, src, smallMediumTiers); err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if files := walkWebP(t, root); len(files) != 0 {
		t.Errorf("files left behind: %v", files)
	}
}

func TestGenerateTiersNoTiers(t *testing.T) {
	paths, err := GenerateTiersFromPath(context.Background(), "ffmpeg-not-needed", t.TempDir(), "library", 1, "x.jpg", nil)
	if err != nil || len(paths) != 0 {
		t.Fatalf("paths=%v err=%v, want empty and nil", paths, err)
	}
}
