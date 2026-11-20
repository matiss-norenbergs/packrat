package downloader

import (
	"bytes"
	"context"
	"encoding/base64"
	"image/jpeg"
	"os/exec"
	"strings"
	"testing"
)

func TestPairFrames(t *testing.T) {
	img := func(n int) [][]byte {
		out := make([][]byte, n)
		for i := range out {
			out[i] = []byte{byte(i)}
		}
		return out
	}
	ts := func(n int) []float64 {
		out := make([]float64, n)
		for i := range out {
			out[i] = float64(i) / 10
		}
		return out
	}
	cases := []struct {
		name            string
		ts              []float64
		imgs            [][]byte
		wantLen, wantTo int
		wantTrunc       bool
	}{
		{"fewer images than timestamps", ts(5), img(3), 3, 5, true},
		{"equal", ts(4), img(4), 4, 4, false},
		{"more images than timestamps", ts(2), img(4), 2, 2, false},
		{"no timestamps", nil, img(3), 0, 0, false},
		{"no images", ts(3), nil, 0, 3, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := pairFrames(c.ts, c.imgs)
			if len(r.Frames) != c.wantLen || r.TotalFrames != c.wantTo || r.Truncated != c.wantTrunc {
				t.Fatalf("got len=%d total=%d trunc=%v", len(r.Frames), r.TotalFrames, r.Truncated)
			}
			for i, f := range r.Frames {
				if f.TimestampSeconds != c.ts[i] {
					t.Fatalf("frame %d paired with %v", i, f.TimestampSeconds)
				}
				if got, _ := base64.StdEncoding.DecodeString(f.ImageBase64); !bytes.Equal(got, c.imgs[i]) {
					t.Fatalf("frame %d image mismatch", i)
				}
			}
		})
	}
}

func TestFrameExtractArgs(t *testing.T) {
	full := strings.Join(frameExtractArgs("in.mp4", 1, 2, false), " ")
	if strings.Contains(full, "-vf") || !strings.Contains(full, "-q:v 2") || !strings.Contains(full, "-frames:v 300") {
		t.Fatalf("full-res args changed: %s", full)
	}
	th := strings.Join(frameExtractArgs("in.mp4", 1, 2, true), " ")
	if !strings.Contains(th, "-vf scale=") || !strings.Contains(th, "-frames:v 1000") {
		t.Fatalf("thumb args wrong: %s", th)
	}
}

// Runs real ffmpeg/ffprobe; skipped when they aren't installed.
func TestExtractFrameThumbnailsReal(t *testing.T) {
	ffmpeg, err1 := exec.LookPath("ffmpeg")
	ffprobe, err2 := exec.LookPath("ffprobe")
	if err1 != nil || err2 != nil {
		t.Skip("ffmpeg/ffprobe not installed")
	}
	video := t.TempDir() + "/v.mp4"
	if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
		"-pix_fmt", "yuv420p", video).CombinedOutput(); err != nil {
		t.Skipf("can't build test video: %v %s", err, out)
	}
	s := &YtDlpService{FFmpegPath: ffmpeg}
	r, err := s.ExtractFrameThumbnails(context.Background(), ffprobe, video, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Frames) < 25 || len(r.Frames) != r.TotalFrames || r.Truncated {
		t.Fatalf("frames=%d total=%d trunc=%v", len(r.Frames), r.TotalFrames, r.Truncated)
	}
	raw, _ := base64.StdEncoding.DecodeString(r.Frames[0].ImageBase64)
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(raw))
	if err != nil || cfg.Width > thumbMaxWidth || cfg.Height > thumbMaxHeight || cfg.Width < 200 {
		t.Fatalf("thumb size %+v err=%v", cfg, err)
	}
	// Full-resolution path must be unchanged.
	full, err := s.ExtractFrameRange(context.Background(), ffprobe, video, 0, 0.2)
	if err != nil || len(full) == 0 {
		t.Fatal(err, len(full))
	}
	raw, _ = base64.StdEncoding.DecodeString(full[0].ImageBase64)
	if cfg, _ := jpeg.DecodeConfig(bytes.NewReader(raw)); cfg.Width != 640 {
		t.Fatalf("full-res width %d", cfg.Width)
	}
}
