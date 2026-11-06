package framematch

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/corona10/goimagehash"
)

func ranked(pairs ...[2]float64) []scored {
	out := make([]scored, len(pairs))
	for i, p := range pairs {
		out[i] = scored{hashedFrame{timestamp: p[0]}, int(p[1])}
	}
	return out
}

func TestSelectCandidatesDistinctRegions(t *testing.T) {
	// Best-first list: a scene around t=100 dominates, then 3 other regions.
	r := ranked(
		[2]float64{100, 1}, [2]float64{101, 1}, [2]float64{99, 2}, [2]float64{102, 2},
		[2]float64{103, 3}, [2]float64{98, 3},
		[2]float64{300, 4}, [2]float64{301, 4},
		[2]float64{107.4, 5}, // 7.4 s from 100: too close
		[2]float64{107.5, 5}, // exactly minSep: accepted
		[2]float64{500, 6},
		[2]float64{900, 7},
	)
	got := selectCandidates(r, 4, 7.5)
	var ts []float64
	for _, c := range got {
		ts = append(ts, c.timestamp)
	}
	want := []float64{100, 300, 107.5, 500}
	if fmt.Sprint(ts) != fmt.Sprint(want) {
		t.Fatalf("got %v, want %v", ts, want)
	}
	for i := range got {
		for j := i + 1; j < len(got); j++ {
			if math.Abs(got[i].timestamp-got[j].timestamp) < 7.5 {
				t.Fatalf("%v and %v closer than 7.5 s", got[i].timestamp, got[j].timestamp)
			}
		}
	}
}

func TestSelectCandidatesRespectsKAndShortLists(t *testing.T) {
	r := ranked([2]float64{0, 1}, [2]float64{10, 2}, [2]float64{20, 3}, [2]float64{30, 4})
	if got := selectCandidates(r, 2, candidateSeparation); len(got) != 2 || got[0].timestamp != 0 || got[1].timestamp != 10 {
		t.Fatalf("k=2: %+v", got)
	}
	if got := selectCandidates(r, 10, candidateSeparation); len(got) != 4 {
		t.Fatalf("fewer regions than k: %+v", got)
	}
	// minSep 0 is the plain top-K.
	adj := ranked([2]float64{5, 1}, [2]float64{6, 1}, [2]float64{7, 1})
	if got := selectCandidates(adj, 3, 0); len(got) != 3 {
		t.Fatalf("minSep 0: %+v", got)
	}
	if candidateSeparation != fineWindowSeconds/2 {
		t.Fatalf("separation %v", candidateSeparation)
	}
}

func TestBestTrackerBoundedReadAhead(t *testing.T) {
	// A big stream of undecodable frames still flows through the same
	// streaming path with the splitter's read-ahead bounded.
	const frameLen = 100 << 10
	g := &genReader{total: 500, frameLen: frameLen}
	sp := newFrameSplitter(g)
	tr := newBestTracker(nil, make([]float64, 500))
	consumed := 0
	for i := 0; ; i++ {
		f, err := sp.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		consumed += len(f)
		if err := tr.observe(i, f); err != nil {
			t.Fatal(err)
		}
		if ahead := g.emitted - consumed; ahead > len(sp.r.buf) {
			t.Fatalf("read %d bytes ahead", ahead)
		}
	}
	if tr.bestDist != math.MaxInt {
		t.Fatal("undecodable frames must not produce a best")
	}
}

func TestBestTrackerPairsIndexWithTimestampAndStops(t *testing.T) {
	a := encodeJPEG(t, patternImage(160, 90, 1), 85)
	b := encodeJPEG(t, patternImage(160, 90, 2), 85)
	img, _ := jpeg.Decode(bytes.NewReader(b))
	ref, _ := goimagehash.PerceptionHash(img)

	stamps := []float64{10, 10.1, 10.2, 10.3}
	stream := bytes.Join([][]byte{a, a, b, a, a, a}, nil) // 6 frames, 4 stamps
	tr := newBestTracker(ref, stamps)
	err := scanFrames(bytes.NewReader(stream), tr.observe)
	if err != errStopScan {
		t.Fatalf("want errStopScan once frames outrun timestamps, got %v", err)
	}
	if tr.bestTS != 10.2 || tr.bestDist != 0 {
		t.Fatalf("best = %v / %d", tr.bestTS, tr.bestDist)
	}
}

// With a 60 fps video the old 300-frame cap covered only the first 5 s of a
// 15 s window. The reference frame sits at 14.5 s; the streamed fine pass must
// still find it.
func TestFineWindowCoversWholeWindowAt60fps(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not available")
	}
	const fps, secs, target = 60, 16, 870 // frame 870 = 14.5 s
	dir := t.TempDir()
	base := encodeJPEG(t, patternImage(320, 180, 11), 92)
	odd := encodeJPEG(t, patternImage(320, 180, 99), 92)
	for i := 0; i < fps*secs; i++ {
		data := base
		if i == target {
			data = odd
		}
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%04d.jpg", i)), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	video := filepath.Join(dir, "v.mp4")
	if out, err := exec.Command(ffmpeg, "-y", "-framerate", "60", "-i", filepath.Join(dir, "f%04d.jpg"),
		"-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", video).CombinedOutput(); err != nil {
		t.Fatalf("building video: %v\n%s", err, out)
	}

	img, _ := jpeg.Decode(bytes.NewReader(odd))
	ref, _ := goimagehash.PerceptionHash(img)
	ts, d, err := fineWindow(context.Background(), ffmpeg, ffprobe, video, 0, 15, ref)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("found t=%.3f distance=%d", ts, d)
	if math.Abs(ts-14.5) > 1.0/fps+1e-6 || d > 4 {
		t.Fatalf("found t=%.3f d=%d, want 14.5", ts, d)
	}
}
