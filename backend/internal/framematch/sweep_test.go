package framematch

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/corona10/goimagehash"
	"github.com/nfnt/resize"
)

// TestMain doubles as a fake ffmpeg: tests point ffmpegPath at the test
// binary itself and set PACKRAT_FAKE_FFMPEG, which the child inherits (the
// parent has no such variable when TestMain runs, so only children act fake).
//
//	hang  - decode requests (-frames:v) succeed with a tiny JPEG. Any other
//	        call (the coarse sweep) sleeps for an hour when the input path
//	        contains "hang" (recording its pid in PACKRAT_FAKE_PIDFILE if
//	        set), and otherwise emits 3 frames and exits 0.
//	flood - writes ~4 MB to stderr and exits 1.
func TestMain(m *testing.M) {
	if mode := os.Getenv("PACKRAT_FAKE_FFMPEG"); mode != "" {
		os.Exit(runFakeFFmpeg(mode))
	}
	os.Exit(m.Run())
}

func runFakeFFmpeg(mode string) int {
	joined := strings.Join(os.Args[1:], " ")
	tiny := func() []byte {
		var buf bytes.Buffer
		_ = jpeg.Encode(&buf, patternImage(32, 32, 1), nil)
		return buf.Bytes()
	}
	switch mode {
	case "flood":
		chunk := strings.Repeat("x", 1023) + "\n"
		for i := 0; i < 4096; i++ {
			os.Stderr.WriteString(chunk)
		}
		os.Stderr.WriteString("the real failure\n")
		return 1
	case "hang":
		if strings.Contains(joined, "-frames:v") {
			os.Stdout.Write(tiny())
			return 0
		}
		if !strings.Contains(joined, "hang") {
			for i := 0; i < 3; i++ {
				os.Stdout.Write(tiny())
			}
			return 0
		}
		if p := os.Getenv("PACKRAT_FAKE_PIDFILE"); p != "" {
			_ = os.WriteFile(p, []byte(strconv.Itoa(os.Getpid())), 0o644)
		}
		time.Sleep(time.Hour)
	}
	return 0
}

func useFake(t *testing.T, mode string) string {
	t.Helper()
	t.Setenv("PACKRAT_FAKE_FFMPEG", mode)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestCoarseSweepCancelReturnsPromptlyAndReapsProcess(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	t.Setenv("PACKRAT_FAKE_PIDFILE", pidFile)
	ffmpeg := useFake(t, "hang")

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		// Wait until the fake is really running, then cancel.
		for i := 0; i < 200; i++ {
			if _, err := os.Stat(pidFile); err == nil {
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
		cancel()
	}()
	start := time.Now()
	_, err := coarseSweep(ctx, ffmpeg, "hang.mp4")
	if err == nil {
		t.Fatal("want error after cancel")
	}
	if d := time.Since(start); d > 8*time.Second {
		t.Fatalf("cancel took %s", d)
	}
	raw, rerr := os.ReadFile(pidFile)
	if rerr != nil {
		t.Fatalf("fake ffmpeg never started: %v", rerr)
	}
	if runtime.GOOS == "windows" {
		return // Signal(0) probing isn't available; Wait() returning is the guarantee.
	}
	pid, _ := strconv.Atoi(string(raw))
	if p, _ := os.FindProcess(pid); p != nil && p.Signal(syscall.Signal(0)) == nil {
		t.Fatalf("ffmpeg process %d still alive after coarseSweep returned", pid)
	}
}

func TestCoarseSweepStderrIsBounded(t *testing.T) {
	ffmpeg := useFake(t, "flood")
	_, err := coarseSweep(context.Background(), ffmpeg, "x.mp4")
	if err == nil {
		t.Fatal("want error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "exit status 1") || !strings.Contains(msg, "the real failure") {
		t.Fatalf("error lost its cause or the stderr tail: %q", msg[max(0, len(msg)-200):])
	}
	if len(msg) > maxStderrBytes+200 {
		t.Fatalf("error message is %d bytes; stderr not bounded", len(msg))
	}
}

func TestCoarseSweepFilter(t *testing.T) {
	want := "fps=1.000000,scale=256:-2:flags=bicubic"
	if got := coarseVideoFilter(coarseFPS); got != want {
		t.Fatalf("filter = %q, want %q", got, want)
	}
}

// Quality guard (no ffmpeg): hashing a downscaled frame must land within a
// few bits of hashing the full-size frame.
func TestDownscaledHashStaysClose(t *testing.T) {
	worst := 0
	for seed := 0; seed < 20; seed++ {
		full := patternImage(1920, 1080, seed)
		small := resize.Resize(coarseScaleWidth, 0, full, resize.Bicubic)
		hf, err := goimagehash.PerceptionHash(full)
		if err != nil {
			t.Fatal(err)
		}
		hs, err := goimagehash.PerceptionHash(small)
		if err != nil {
			t.Fatal(err)
		}
		d, _ := hf.Distance(hs)
		if d > worst {
			worst = d
		}
	}
	t.Logf("worst Hamming distance full vs %dpx over 20 frames: %d / 64", coarseScaleWidth, worst)
	if worst > 6 { // observed max: 4
		t.Fatalf("downscaling moved the hash by %d bits", worst)
	}
}

func requireFFmpeg(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not available")
	}
	return p
}

// makeTestVideo writes secs distinct 1280x720 patterns, one per second.
func makeTestVideo(t *testing.T, ffmpeg string, secs int) string {
	t.Helper()
	dir := t.TempDir()
	for i := 0; i < secs; i++ {
		b := encodeJPEG(t, patternImage(1280, 720, i+100), 92)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%03d.jpg", i)), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	out := filepath.Join(dir, "v.mp4")
	cmd := exec.Command(ffmpeg, "-y", "-framerate", "1", "-i", filepath.Join(dir, "f%03d.jpg"),
		"-r", "10", "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("building test video: %v\n%s", err, b)
	}
	return out
}

// legacyCoarseSweep is the pre-change behavior: native resolution, whole
// stream buffered, then hashed.
func legacyCoarseSweep(t *testing.T, ffmpeg, video string) []hashedFrame {
	t.Helper()
	out, err := exec.Command(ffmpeg, "-y", "-i", video, "-vf", fmt.Sprintf("fps=%f", coarseFPS),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	frames, err := hashFrameStream(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	return frames
}

func bestFrame(frames []hashedFrame, ref *goimagehash.ImageHash) (float64, int) {
	best, bestD := -1.0, 1<<30
	for _, f := range frames {
		d, _ := ref.Distance(f.hash)
		if d < bestD {
			best, bestD = f.timestamp, d
		}
	}
	return best, bestD
}

func TestCoarseSweepMatchesLegacyPath(t *testing.T) {
	ffmpeg := requireFFmpeg(t)
	const secs = 12
	video := makeTestVideo(t, ffmpeg, secs)

	legacy := legacyCoarseSweep(t, ffmpeg, video)
	got, err := coarseSweep(context.Background(), ffmpeg, video)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(legacy) || len(got) < secs-1 {
		t.Fatalf("frame counts: new %d legacy %d", len(got), len(legacy))
	}
	worst := 0
	for i := range got {
		if got[i].timestamp != legacy[i].timestamp {
			t.Fatalf("timestamp %d: %v vs %v", i, got[i].timestamp, legacy[i].timestamp)
		}
		d, _ := got[i].hash.Distance(legacy[i].hash)
		if d > worst {
			worst = d
		}
	}
	t.Logf("worst per-frame Hamming distance new vs legacy: %d / 64", worst)
	if worst > 9 { // observed max: 6
		t.Fatalf("hashes diverged by %d bits", worst)
	}

	// Reference = pattern for second 7, re-encoded smaller at lower quality.
	refJPEG := encodeJPEG(t, patternImage(640, 360, 107), 60)
	refImg, _ := jpeg.Decode(bytes.NewReader(refJPEG))
	ref, _ := goimagehash.PerceptionHash(refImg)
	wantTS, wantD := bestFrame(legacy, ref)
	gotTS, gotD := bestFrame(got, ref)
	t.Logf("best match: legacy t=%v d=%d, new t=%v d=%d", wantTS, wantD, gotTS, gotD)
	if gotTS != wantTS || gotTS != 7 {
		t.Fatalf("best timestamp: new %v, legacy %v, want 7", gotTS, wantTS)
	}
}

func TestHashFrameStreamKeepsIndexOnBadFrame(t *testing.T) {
	good := encodeJPEG(t, patternImage(64, 48, 3), 85)
	bad := []byte{0xFF, 0xD8, 0x00, 0x01, 0xFF, 0xD9}
	stream := bytes.Join([][]byte{good, bad, good}, nil)
	frames, err := hashFrameStream(io.Reader(bytes.NewReader(stream)))
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 2 || frames[0].timestamp != 0 || frames[1].timestamp != 2/coarseFPS {
		t.Fatalf("frames = %+v", frames)
	}
}
