package importer

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRoundDurationSeconds(t *testing.T) {
	for _, tc := range []struct {
		in   float64
		want int
	}{
		{9.52, 10}, {9.49, 9}, {9.5, 10}, {20.0, 20}, {20.4, 20}, {59.6, 60}, {0.4, 1}, {0.001, 1}, {0.5, 1}, {1.2, 1},
	} {
		if got := RoundDurationSeconds(tc.in); got != tc.want {
			t.Errorf("RoundDurationSeconds(%v) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// A real 9.52 s file probes as 10 (it used to be truncated to 9).
func TestProbeRoundsDuration(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	path := filepath.Join(t.TempDir(), "clip.wav")
	if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "9.52", path).CombinedOutput(); err != nil {
		t.Skipf("cannot generate a test file: %v %s", err, out)
	}
	p := Probe(context.Background(), ffprobe, path)
	if p.DurationSeconds == nil || *p.DurationSeconds != 10 {
		t.Fatalf("DurationSeconds = %v, want 10", p.DurationSeconds)
	}
}
