// Package framematch locates the video frame a thumbnail was most likely
// taken from. The approach (coarse whole-video pHash sweep at 1fps, then a
// windowed fine pass on the best few candidates) and its defaults (top-K=6,
// a 15s fine window) were picked empirically with cmd/framematch-bench —
// see that tool's doc comment for the benchmark methodology. On the sample
// video used to tune these defaults: ~83% of degraded/cropped reference
// thumbnails were relocated to within 1s of their true source frame.
package framematch

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image/jpeg"
	"os/exec"
	"sort"

	"github.com/corona10/goimagehash"

	"packrat/backend/internal/downloader"
)

const (
	// topK is how many coarse-sweep candidates get refined in the fine
	// pass — 6 was the point past which more candidates stopped finding
	// additional hits in benchmarking (top-k=10 matched top-k=6 exactly).
	topK = 6
	// fineWindowSeconds is the width of each fine-pass window, capped at
	// downloader.MaxFrameWindowSeconds (ExtractFrameRange's own limit).
	// Benchmarking showed hit rate still climbing at this cap rather than
	// plateauing, so it's set to the max allowed rather than a smaller
	// value — narrower windows measurably cost accuracy.
	fineWindowSeconds = downloader.MaxFrameWindowSeconds
	// coarseFPS is the whole-video sampling rate for the initial sweep.
	// A full per-frame decode (this is not keyframe-only), but 1fps kept
	// the one-time sweep to roughly a minute on the tuning video.
	coarseFPS = 1.0
)

// Result is the best-matching frame found for a reference image.
type Result struct {
	TimestampSeconds float64
	// Score is 0-100, higher is a closer perceptual match. Callers should
	// present low scores as "low confidence" rather than hiding them —
	// benchmarking showed misses still often score in the 70-80s, so a
	// hard cutoff would just as often hide a correct near-miss as a wrong
	// guess.
	Score       float64
	ImageBase64 string
	// ReferenceImageBase64 echoes back the (already-decoded) reference
	// image the caller passed in — the caller (mode "url") may never have
	// persisted it anywhere, so this is the only way the frontend's
	// compare view has to display what the match was actually judged
	// against.
	ReferenceImageBase64 string
}

// Match scans videoAbsPath for the frame that best matches referenceJPEG
// (already-decoded JPEG bytes — see downloader.DecodeImageToJPEG for
// converting an arbitrary source format first). Typically takes tens of
// seconds to low minutes depending on video length; callers should run
// this off the request goroutine (see JobStore).
func Match(ctx context.Context, ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, referenceJPEG []byte) (Result, error) {
	refImg, err := jpeg.Decode(bytes.NewReader(referenceJPEG))
	if err != nil {
		return Result{}, fmt.Errorf("decode reference image: %w", err)
	}
	refHash, err := goimagehash.PerceptionHash(refImg)
	if err != nil {
		return Result{}, fmt.Errorf("hash reference image: %w", err)
	}

	coarse, err := coarseSweep(ctx, ytdlp.FFmpegPath, videoAbsPath)
	if err != nil {
		return Result{}, fmt.Errorf("coarse sweep: %w", err)
	}
	if len(coarse) == 0 {
		return Result{}, fmt.Errorf("coarse sweep produced no frames")
	}

	type scored struct {
		hashedFrame
		distance int
	}
	candidates := make([]scored, 0, len(coarse))
	for _, f := range coarse {
		d, err := refHash.Distance(f.hash)
		if err != nil {
			continue
		}
		candidates = append(candidates, scored{f, d})
	}
	if len(candidates) == 0 {
		return Result{}, fmt.Errorf("no candidate frames could be hashed")
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].distance < candidates[j].distance })

	k := topK
	if k > len(candidates) {
		k = len(candidates)
	}

	bestTS, bestDist := candidates[0].timestamp, candidates[0].distance
	var bestJPEG []byte
	covered := make([]struct{ lo, hi float64 }, 0, k)
	for i := 0; i < k; i++ {
		center := candidates[i].timestamp
		half := fineWindowSeconds / 2
		lo, hi := center-half, center+half
		if lo < 0 {
			lo = 0
		}

		alreadyCovered := false
		for _, c := range covered {
			if lo < c.hi && hi > c.lo {
				alreadyCovered = true
				break
			}
		}
		if alreadyCovered {
			continue
		}
		covered = append(covered, struct{ lo, hi float64 }{lo, hi})

		frames, err := ytdlp.ExtractFrameRange(ctx, ffprobePath, videoAbsPath, lo, hi)
		if err != nil || len(frames) == 0 {
			continue
		}
		for _, f := range frames {
			raw, err := base64.StdEncoding.DecodeString(f.ImageBase64)
			if err != nil {
				continue
			}
			img, err := jpeg.Decode(bytes.NewReader(raw))
			if err != nil {
				continue
			}
			h, err := goimagehash.PerceptionHash(img)
			if err != nil {
				continue
			}
			d, err := refHash.Distance(h)
			if err != nil {
				continue
			}
			if bestJPEG == nil || d < bestDist {
				bestDist = d
				bestTS = f.TimestampSeconds
				bestJPEG = raw
			}
		}
	}

	if bestJPEG == nil {
		// The fine pass never beat (or even matched) the coarse sweep's
		// own best frame — fall back to re-extracting that single frame
		// so the result always carries real image bytes.
		frames, err := ytdlp.ExtractFrameRange(ctx, ffprobePath, videoAbsPath, maxFloat(0, bestTS-1), bestTS+1)
		if err != nil || len(frames) == 0 {
			return Result{}, fmt.Errorf("couldn't extract the best-matching frame")
		}
		raw, err := base64.StdEncoding.DecodeString(frames[0].ImageBase64)
		if err != nil {
			return Result{}, fmt.Errorf("decode fallback frame: %w", err)
		}
		bestJPEG = raw
		bestTS = frames[0].TimestampSeconds
	}

	score := 100 * float64(refHash.Bits()-bestDist) / float64(refHash.Bits())
	return Result{
		TimestampSeconds:     bestTS,
		Score:                score,
		ImageBase64:          base64.StdEncoding.EncodeToString(bestJPEG),
		ReferenceImageBase64: base64.StdEncoding.EncodeToString(referenceJPEG),
	}, nil
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

type hashedFrame struct {
	timestamp float64
	hash      *goimagehash.ImageHash
}

// coarseSweep decodes the whole video at coarseFPS via a single ffmpeg
// invocation, buffering the whole MJPEG stream and splitting it with
// splitMJPEGStream rather than decoding frames one at a time off the pipe —
// see that function's doc comment for why the more obvious streaming
// approach isn't reliable here.
func coarseSweep(ctx context.Context, ffmpegPath, videoAbsPath string) ([]hashedFrame, error) {
	args := []string{
		"-y", "-i", videoAbsPath,
		"-vf", fmt.Sprintf("fps=%f", coarseFPS),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, stderr.String())
	}

	images := splitMJPEGStream(out)
	frames := make([]hashedFrame, 0, len(images))
	for i, raw := range images {
		img, err := jpeg.Decode(bytes.NewReader(raw))
		if err != nil {
			continue
		}
		h, err := goimagehash.PerceptionHash(img)
		if err != nil {
			continue
		}
		frames = append(frames, hashedFrame{timestamp: float64(i) / coarseFPS, hash: h})
	}
	return frames, nil
}

// splitMJPEGStream splits a concatenated stream of JPEG images (as produced
// by ffmpeg's "-f image2pipe -vcodec mjpeg -") into individual JPEG byte
// slices, by scanning for SOI (0xFFD8) / EOI (0xFFD9) marker pairs — the
// same technique internal/downloader/trim_frames.go's ExtractFrameRange
// uses (and cmd/framematch-bench independently re-derived while confirming
// that repeatedly calling jpeg.Decode on the raw stream isn't reliable).
// JPEG's entropy-coded scan data always byte-stuffs any literal 0xFF byte
// with a following 0x00, so a raw 0xFFD9 outside that stuffing unambiguously
// marks the end of an image.
func splitMJPEGStream(data []byte) [][]byte {
	var images [][]byte
	i := 0
	for i < len(data)-1 {
		if data[i] != 0xFF || data[i+1] != 0xD8 {
			i++
			continue
		}
		start := i
		j := i + 2
		for j < len(data)-1 {
			if data[j] == 0xFF && data[j+1] == 0xD9 {
				images = append(images, data[start:j+2])
				i = j + 2
				break
			}
			j++
		}
		if j >= len(data)-1 {
			break
		}
	}
	return images
}
