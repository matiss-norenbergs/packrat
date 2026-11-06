package framematch

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/corona10/goimagehash"

	"packrat/backend/internal/downloader"
)

// TestAccuracyHarness is an opt-in measurement harness (not a regression
// test): for a real video and a list of true timestamps it reports, per
// configuration, where the true location lands in the coarse ranking and what
// the full pipeline finally reports.
//
//	PACKRAT_FM_VIDEO    path to the video
//	PACKRAT_FM_TIMES    comma-separated true timestamps in seconds
//	PACKRAT_FM_CONFIGS  comma-separated fps:topK:minSep, e.g. "1:6:0,1:6:7.5,4:12:7.5"
//	PACKRAT_FM_FFMPEG / PACKRAT_FM_FFPROBE  binaries (default: from PATH)
//
// rank        1-based rank of the best coarse frame within 1 s of the truth in
//
//	the raw distance ordering (ties count as better ranks)
//
// region      1-based position of the truth's region (within 7.5 s) among the
//
//	suppressed (distinct-region) candidates; the fine pass sees it when
//	region <= topK
//
// Run:  PACKRAT_FM_VIDEO=... PACKRAT_FM_TIMES=47,480 go test ./internal/framematch -run AccuracyHarness -v -timeout 3h
func TestAccuracyHarness(t *testing.T) {
	video := os.Getenv("PACKRAT_FM_VIDEO")
	if video == "" {
		t.Skip("PACKRAT_FM_VIDEO not set")
	}
	ffmpeg := envOr("PACKRAT_FM_FFMPEG", "ffmpeg")
	ffprobe := envOr("PACKRAT_FM_FFPROBE", "ffprobe")
	var times []float64
	for _, s := range strings.Split(os.Getenv("PACKRAT_FM_TIMES"), ",") {
		v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			t.Fatalf("bad time %q", s)
		}
		times = append(times, v)
	}
	var cfgs []config
	for _, s := range strings.Split(envOr("PACKRAT_FM_CONFIGS", "1:6:0"), ",") {
		p := strings.Split(strings.TrimSpace(s), ":")
		if len(p) != 3 {
			t.Fatalf("bad config %q", s)
		}
		fps, _ := strconv.ParseFloat(p[0], 64)
		k, _ := strconv.Atoi(p[1])
		sep, _ := strconv.ParseFloat(p[2], 64)
		cfgs = append(cfgs, config{fps: fps, topK: k, minSep: sep})
	}

	ctx := context.Background()
	ytdlp := &downloader.YtDlpService{FFmpegPath: ffmpeg}
	sweeps := map[float64][]hashedFrame{}
	for _, c := range cfgs {
		if _, ok := sweeps[c.fps]; ok {
			continue
		}
		start := time.Now()
		fr, err := coarseSweepFPS(ctx, ffmpeg, video, c.fps)
		if err != nil {
			t.Fatal(err)
		}
		sweeps[c.fps] = fr
		t.Logf("coarse sweep fps=%v: %d frames in %s", c.fps, len(fr), time.Since(start).Round(time.Second))
	}

	for _, T := range times {
		refJPEG, err := exec.Command(ffmpeg, "-v", "error", "-ss", strconv.FormatFloat(T, 'f', 3, 64), "-i", video,
			"-frames:v", "1", "-q:v", "2", "-f", "image2pipe", "-vcodec", "mjpeg", "-").Output()
		if err != nil || len(refJPEG) == 0 {
			t.Fatalf("reference frame at %v: %v", T, err)
		}
		img, err := jpeg.Decode(bytes.NewReader(refJPEG))
		if err != nil {
			t.Fatal(err)
		}
		ref, _ := goimagehash.PerceptionHash(img)
		for _, c := range cfgs {
			coarse := sweeps[c.fps]
			ranked := rankFrames(coarse, ref)
			rank := 0
			for i, r := range ranked {
				if r.timestamp >= T-1 && r.timestamp <= T+1 {
					rank = 1 + countBetter(ranked, r.distance)
					_ = i
					break
				}
			}
			region := 0
			for i, r := range selectCandidates(ranked, len(ranked), maxF(c.minSep, 0.001)) {
				if r.timestamp >= T-candidateSeparation && r.timestamp <= T+candidateSeparation {
					region = i + 1
					break
				}
			}
			if os.Getenv("PACKRAT_FM_RANKONLY") != "" {
				t.Logf("T=%-7v fps=%v k=%-2d sep=%-4v rank=%-5d region=%-3d", T, c.fps, c.topK, c.minSep, rank, region)
				continue
			}
			start := time.Now()
			res, err := refine(ctx, ytdlp, ffprobe, video, refJPEG, ref, newSignature(img), coarse, c)
			el := time.Since(start).Round(100 * time.Millisecond)
			if err != nil {
				t.Logf("T=%-7v fps=%v k=%d sep=%v rank=%d region=%d ERROR %v", T, c.fps, c.topK, c.minSep, rank, region, err)
				continue
			}
			t.Logf("T=%-7v fps=%v k=%-2d sep=%-4v rank=%-5d region=%-3d reported=%-8.3f err=%-7.3f score=%-6.2f fine=%s",
				T, c.fps, c.topK, c.minSep, rank, region, res.TimestampSeconds, res.TimestampSeconds-T, res.Score, el)
		}
	}
}

func countBetter(ranked []scored, d int) int {
	n := 0
	for _, r := range ranked {
		if r.distance < d {
			n++
		}
	}
	return n
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

var _ = fmt.Sprintf
