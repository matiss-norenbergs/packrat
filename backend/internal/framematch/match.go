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
	"errors"
	"fmt"
	"image/jpeg"
	"io"
	"os/exec"
	"sort"
	"time"

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
	// coarseScaleWidth is the width (px) ffmpeg downscales each coarse-sweep
	// frame to before piping it out. The perceptual hash resizes to 64x64
	// anyway, so 256 keeps 4x headroom while shrinking a frame from hundreds
	// of KB (native 1080p JPEG) to a few KB. Height follows the aspect ratio,
	// rounded to an even number (-2).
	coarseScaleWidth = 256
	// maxStderrBytes bounds how much of ffmpeg stderr is kept for error
	// messages (the tail: the actual failure is printed last).
	maxStderrBytes = 8 << 10
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

// coarseVideoFilter is the ffmpeg -vf chain for the coarse sweep.
func coarseVideoFilter() string {
	return fmt.Sprintf("fps=%f,scale=%d:-2:flags=bicubic", coarseFPS, coarseScaleWidth)
}

// coarseSweep decodes the whole video at coarseFPS via a single ffmpeg
// invocation (downscaled to coarseScaleWidth) and hashes each frame as soon
// as it has been read off the pipe, so peak memory is one frame plus the
// hash list — not the whole video. Frames are split with frameSplitter (SOI/
// EOI markers) rather than repeated jpeg.Decode calls on the raw stream; see
// its doc comment for why.
func coarseSweep(ctx context.Context, ffmpegPath, videoAbsPath string) ([]hashedFrame, error) {
	args := []string{
		"-y", "-i", videoAbsPath,
		"-vf", coarseVideoFilter(),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	stderr := &tailBuffer{max: maxStderrBytes}
	cmd.Stderr = stderr
	// If ffmpeg leaves a grandchild holding a pipe open after being killed,
	// don't let Wait block forever.
	cmd.WaitDelay = 5 * time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("%w: %s", err, stderr.String())
	}

	frames, scanErr := hashFrameStream(stdout)
	if scanErr != nil {
		// Stop ffmpeg so Wait returns promptly; the scan error is reported.
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()

	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if scanErr != nil {
		return nil, scanErr
	}
	if waitErr != nil {
		return nil, fmt.Errorf("%w: %s", waitErr, stderr.String())
	}
	return frames, nil
}

// hashFrameStream reads an MJPEG stream from r, hashing each frame as it
// completes. A frame that fails to decode is skipped but still consumes its
// index, so timestamps stay frame-index / coarseFPS.
func hashFrameStream(r io.Reader) ([]hashedFrame, error) {
	sp := newFrameSplitter(r)
	var frames []hashedFrame
	for i := 0; ; i++ {
		raw, err := sp.Next()
		if err == io.EOF {
			return frames, nil
		}
		if err != nil {
			return frames, err
		}
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
}

// maxFrameBytes caps a single frame in frameSplitter so a corrupt stream
// with an SOI but no EOI can't grow the buffer without limit.
const maxFrameBytes = 32 << 20

// frameSplitter incrementally splits a concatenated stream of JPEG images (as
// produced by ffmpeg's "-f image2pipe -vcodec mjpeg -") by scanning for SOI
// (0xFFD8) / EOI (0xFFD9) marker pairs — the same technique as
// internal/downloader/trim_frames.go's ExtractFrameRange (and
// cmd/framematch-bench independently re-derived while confirming that
// repeatedly calling jpeg.Decode on the raw stream isn't reliable). JPEG's
// entropy-coded scan data always byte-stuffs any literal 0xFF byte with a
// following 0x00, so a raw 0xFFD9 outside that stuffing unambiguously marks
// the end of an image.
type frameSplitter struct {
	r   *byteReader
	buf []byte
}

func newFrameSplitter(r io.Reader) *frameSplitter {
	return &frameSplitter{r: newByteReader(r), buf: make([]byte, 0, 64<<10)}
}

// Next returns the next complete frame. The slice is only valid until the
// following call. io.EOF means the stream ended; a trailing partial frame
// (ffmpeg killed mid-write) is dropped.
func (s *frameSplitter) Next() ([]byte, error) {
	var prev byte
	for { // find SOI
		b, err := s.r.ReadByte()
		if err != nil {
			return nil, err
		}
		if prev == 0xFF && b == 0xD8 {
			break
		}
		prev = b
	}
	s.buf = append(s.buf[:0], 0xFF, 0xD8)
	prev = 0xD8
	for {
		b, err := s.r.ReadByte()
		if err != nil {
			return nil, err
		}
		s.buf = append(s.buf, b)
		if prev == 0xFF && b == 0xD9 {
			return s.buf, nil
		}
		if len(s.buf) > maxFrameBytes {
			return nil, errors.New("mjpeg frame exceeds size limit")
		}
		prev = b
	}
}

// byteReader is a small buffered reader. It tolerates readers that return 0
// bytes with a nil error, and only surfaces an error once buffered bytes
// have been consumed. buffered() reports how many bytes were read from the
// source but not yet handed out (used by the memory-bound test).
type byteReader struct {
	r   io.Reader
	buf [32 << 10]byte
	pos int
	n   int
}

func newByteReader(r io.Reader) *byteReader { return &byteReader{r: r} }

func (b *byteReader) buffered() int { return b.n - b.pos }

func (b *byteReader) ReadByte() (byte, error) {
	for b.pos >= b.n {
		n, err := b.r.Read(b.buf[:])
		b.pos, b.n = 0, n
		if n == 0 && err != nil {
			return 0, err
		}
	}
	c := b.buf[b.pos]
	b.pos++
	return c, nil
}

// tailBuffer is an io.Writer that keeps only the last max bytes written.
type tailBuffer struct {
	max int
	buf []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = append(t.buf[:0], t.buf[len(t.buf)-t.max:]...)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string { return string(bytes.TrimSpace(t.buf)) }
