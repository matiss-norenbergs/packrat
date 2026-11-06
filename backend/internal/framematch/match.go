// Package framematch locates the video frame a thumbnail was most likely
// taken from. The approach (coarse whole-video pHash sweep, then a windowed
// fine pass over the best few distinct regions) and its defaults were picked
// empirically — see docs/architecture.md ("Frame matching") for the constants
// and the measurements behind them, and cmd/framematch-bench for the original
// benchmark methodology.
package framematch

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math"
	"os/exec"
	"sort"
	"strconv"
	"time"

	"github.com/corona10/goimagehash"

	"packrat/backend/internal/downloader"
)

const (
	// topK is how many distinct coarse-sweep regions get refined in the fine
	// pass (see selectCandidates).
	topK = 10
	// fineWindowSeconds is the width of each fine-pass window.
	fineWindowSeconds = downloader.MaxFrameWindowSeconds
	// candidateSeparation is the minimum distance between two shortlisted
	// coarse candidates (non-maximum suppression): the best frames of a scene
	// are adjacent samples, so without it the shortlist is mostly one region.
	candidateSeparation = fineWindowSeconds / 2
	// coarseFPS is the whole-video sampling rate for the initial sweep. ffmpeg
	// decodes every frame regardless; the rate only sets how many 256 px frames
	// get hashed.
	coarseFPS = 4.0
	// coarseScaleWidth is the width (px) ffmpeg downscales each swept frame to
	// before piping it out. The perceptual hash resizes to 64x64 anyway, so 256
	// keeps 4x headroom while shrinking a frame from hundreds of KB (native
	// 1080p JPEG) to a few KB. Height follows the aspect ratio, rounded to an
	// even number (-2).
	coarseScaleWidth = 256
	// maxFineFrames is a safety ceiling on frames decoded for one fine window
	// (a 15 s window at 120 fps is 1800).
	maxFineFrames = 2000
	// maxStderrBytes bounds how much of ffmpeg stderr is kept for error
	// messages (the tail: the actual failure is printed last).
	maxStderrBytes = 8 << 10
)

// config holds the tunables; production uses defaultConfig, the accuracy
// harness (accuracy_test.go) sweeps others.
type config struct {
	fps    float64 // coarse sampling rate
	topK   int     // distinct regions refined
	minSep float64 // seconds between shortlisted candidates (0 = plain top-K)
}

var defaultConfig = config{fps: coarseFPS, topK: topK, minSep: candidateSeparation}

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
	return matchWith(ctx, ytdlp, ffprobePath, videoAbsPath, referenceJPEG, defaultConfig)
}

type scored struct {
	hashedFrame
	distance int
}

// rankFrames orders the coarse frames by distance to ref (best first; ties
// keep timestamp order).
func rankFrames(coarse []hashedFrame, ref *goimagehash.ImageHash) []scored {
	ranked := make([]scored, 0, len(coarse))
	for _, f := range coarse {
		d, err := ref.Distance(f.hash)
		if err != nil {
			continue
		}
		ranked = append(ranked, scored{f, d})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].distance < ranked[j].distance })
	return ranked
}

// selectCandidates walks the ranked frames and keeps up to k whose timestamps
// are at least minSep from every already kept one (non-maximum suppression),
// so the fine pass refines k distinct regions rather than k adjacent seconds
// of one scene.
func selectCandidates(ranked []scored, k int, minSep float64) []scored {
	out := make([]scored, 0, k)
	for _, c := range ranked {
		if len(out) >= k {
			break
		}
		ok := true
		for _, a := range out {
			if math.Abs(c.timestamp-a.timestamp) < minSep {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, c)
		}
	}
	return out
}

func matchWith(ctx context.Context, ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, referenceJPEG []byte, cfg config) (Result, error) {
	refImg, err := jpeg.Decode(bytes.NewReader(referenceJPEG))
	if err != nil {
		return Result{}, fmt.Errorf("decode reference image: %w", err)
	}
	refHash, err := goimagehash.PerceptionHash(refImg)
	if err != nil {
		return Result{}, fmt.Errorf("hash reference image: %w", err)
	}

	coarse, err := coarseSweepFPS(ctx, ytdlp.FFmpegPath, videoAbsPath, cfg.fps)
	if err != nil {
		return Result{}, fmt.Errorf("coarse sweep: %w", err)
	}
	return refine(ctx, ytdlp, ffprobePath, videoAbsPath, referenceJPEG, refHash, newSignature(refImg), coarse, cfg)
}

// refine ranks the coarse frames against refHash and runs the fine pass.
func refine(ctx context.Context, ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, referenceJPEG []byte, refHash *goimagehash.ImageHash, refSig signature, coarse []hashedFrame, cfg config) (Result, error) {
	if len(coarse) == 0 {
		return Result{}, fmt.Errorf("coarse sweep produced no frames")
	}
	ranked := rankFrames(coarse, refHash)
	if len(ranked) == 0 {
		return Result{}, fmt.Errorf("no candidate frames could be hashed")
	}
	candidates := selectCandidates(ranked, cfg.topK, cfg.minSep)

	// The fine pass hashes every frame of each candidate's window; only the
	// best (distance, timestamp) is kept. With no usable fine result the best
	// coarse frame stands.
	best := hit{ts: ranked[0].timestamp, dist: ranked[0].distance}
	fineFound := false
	half := fineWindowSeconds / 2
	for _, c := range candidates {
		lo := math.Max(0, c.timestamp-half)
		h, err := fineWindow(ctx, ytdlp.FFmpegPath, ffprobePath, videoAbsPath, lo, c.timestamp+half, refHash, refSig)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return Result{}, ctxErr
			}
			continue
		}
		if !fineFound || h.betterThan(best) {
			best, fineFound = h, true
		}
	}

	raw, ts, err := extractFullFrame(ctx, ytdlp, ffprobePath, videoAbsPath, best.ts)
	if err != nil {
		return Result{}, err
	}
	score := 100 * float64(refHash.Bits()-best.dist) / float64(refHash.Bits())
	return Result{
		TimestampSeconds:     ts,
		Score:                score,
		ImageBase64:          base64.StdEncoding.EncodeToString(raw),
		ReferenceImageBase64: base64.StdEncoding.EncodeToString(referenceJPEG),
	}, nil
}

// fineWindow decodes every frame of [lo, hi) once (downscaled like the coarse
// sweep, no frame cap beyond maxFineFrames), hashes each as it streams in and
// returns the timestamp and distance of the closest one. Frames are never
// retained. The i-th decoded frame is paired with the i-th ffprobe timestamp.
func fineWindow(ctx context.Context, ffmpegPath, ffprobePath, videoAbsPath string, lo, hi float64, ref *goimagehash.ImageHash, refSig signature) (hit, error) {
	stamps := downloader.ProbeFrameTimestamps(ctx, ffprobePath, videoAbsPath, lo, hi-lo)
	if len(stamps) == 0 {
		return hit{}, errors.New("no frame timestamps in window")
	}
	args := []string{
		"-y", "-ss", formatSeconds(lo), "-i", videoAbsPath, "-t", formatSeconds(hi - lo),
		"-vsync", "0", "-frames:v", strconv.Itoa(maxFineFrames),
		"-vf", fmt.Sprintf("scale=%d:-2:flags=bicubic", coarseScaleWidth),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	tr := newBestTracker(ref, refSig, stamps)
	if err := streamMJPEG(ctx, ffmpegPath, args, tr.observe); err != nil {
		return hit{}, err
	}
	if !tr.found {
		return hit{}, errors.New("no frame in window could be hashed")
	}
	return tr.best, nil
}

// hit is a frame's closeness to the reference: the perceptual-hash distance,
// with a coarse luma-signature difference (sad) breaking exact ties — flat or
// fading scenes give dozens of frames the same hash, and the signature picks
// the one that really looks most like the reference.
type hit struct {
	ts   float64
	dist int
	sad  int
}

func (h hit) betterThan(o hit) bool {
	return h.dist < o.dist || (h.dist == o.dist && h.sad < o.sad)
}

// bestTracker keeps the closest frame of a fine window as frames stream in:
// the i-th frame is paired with stamps[i]; nothing but the best hit is
// retained.
type bestTracker struct {
	ref    *goimagehash.ImageHash
	refSig signature
	stamps []float64
	best   hit
	found  bool
}

func newBestTracker(ref *goimagehash.ImageHash, refSig signature, stamps []float64) *bestTracker {
	return &bestTracker{ref: ref, refSig: refSig, stamps: stamps}
}

func (b *bestTracker) observe(i int, raw []byte) error {
	if i >= len(b.stamps) {
		return errStopScan
	}
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil
	}
	h, err := goimagehash.PerceptionHash(img)
	if err != nil {
		return nil
	}
	d, err := b.ref.Distance(h)
	if err != nil || (b.found && d > b.best.dist) {
		return nil
	}
	cand := hit{ts: b.stamps[i], dist: d, sad: b.refSig.distance(newSignature(img))}
	if !b.found || cand.betterThan(b.best) {
		b.best, b.found = cand, true
	}
	return nil
}

const sigSide = 16

// signature is a 16x16 luma thumbnail, sampled sparsely — only a tie-break,
// so it just has to be cheap and stable across the reference's and the
// frame's different resolutions.
type signature [sigSide * sigSide]uint8

func newSignature(img image.Image) signature {
	var s signature
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return s
	}
	const sub = 4 // samples per cell side
	for cy := 0; cy < sigSide; cy++ {
		for cx := 0; cx < sigSide; cx++ {
			sum := 0
			for sy := 0; sy < sub; sy++ {
				for sx := 0; sx < sub; sx++ {
					x := b.Min.X + ((cx*sub+sx)*2+1)*w/(sigSide*sub*2)
					y := b.Min.Y + ((cy*sub+sy)*2+1)*h/(sigSide*sub*2)
					r, g, bl, _ := img.At(x, y).RGBA()
					sum += int((299*r + 587*g + 114*bl) / 1000 >> 8)
				}
			}
			s[cy*sigSide+cx] = uint8(sum / (sub * sub))
		}
	}
	return s
}

func (s signature) distance(o signature) int {
	n := 0
	for i := range s {
		d := int(s[i]) - int(o[i])
		if d < 0 {
			d = -d
		}
		n += d
	}
	return n
}

// extractFullFrame returns the full-quality JPEG of the frame at ts (and its
// exact timestamp), via a narrow ExtractFrameRange with a wider retry.
func extractFullFrame(ctx context.Context, ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, ts float64) ([]byte, float64, error) {
	for _, pad := range [][2]float64{{0.005, 0.5}, {1, 1}} {
		frames, err := ytdlp.ExtractFrameRange(ctx, ffprobePath, videoAbsPath, math.Max(0, ts-pad[0]), ts+pad[1])
		if err != nil || len(frames) == 0 {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, 0, ctxErr
			}
			continue
		}
		best := frames[0]
		for _, f := range frames[1:] {
			if math.Abs(f.TimestampSeconds-ts) < math.Abs(best.TimestampSeconds-ts) {
				best = f
			}
		}
		raw, err := base64.StdEncoding.DecodeString(best.ImageBase64)
		if err != nil {
			return nil, 0, fmt.Errorf("decode best frame: %w", err)
		}
		return raw, best.TimestampSeconds, nil
	}
	return nil, 0, fmt.Errorf("couldn't extract the best-matching frame")
}

func formatSeconds(t float64) string { return strconv.FormatFloat(t, 'f', 3, 64) }

type hashedFrame struct {
	timestamp float64
	hash      *goimagehash.ImageHash
}

// coarseVideoFilter is the ffmpeg -vf chain for the coarse sweep.
func coarseVideoFilter(fps float64) string {
	return fmt.Sprintf("fps=%f,scale=%d:-2:flags=bicubic", fps, coarseScaleWidth)
}

// coarseSweep samples the whole video at coarseFPS.
func coarseSweep(ctx context.Context, ffmpegPath, videoAbsPath string) ([]hashedFrame, error) {
	return coarseSweepFPS(ctx, ffmpegPath, videoAbsPath, coarseFPS)
}

// coarseSweepFPS decodes the whole video at fps via a single ffmpeg invocation
// (downscaled to coarseScaleWidth) and hashes each frame as soon as it has
// been read off the pipe, so peak memory is one frame plus the hash list — not
// the whole video.
func coarseSweepFPS(ctx context.Context, ffmpegPath, videoAbsPath string, fps float64) ([]hashedFrame, error) {
	args := []string{
		"-y", "-i", videoAbsPath,
		"-vf", coarseVideoFilter(fps),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	var frames []hashedFrame
	err := streamMJPEG(ctx, ffmpegPath, args, func(i int, raw []byte) error {
		if f, ok := hashFrame(i, raw, fps); ok {
			frames = append(frames, f)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return frames, nil
}

// errStopScan, returned from a streamMJPEG callback, ends the scan early
// without an error.
var errStopScan = errors.New("stop scan")

// streamMJPEG runs ffmpeg and calls fn for each frame of its MJPEG stdout as
// it arrives (the slice is only valid during the call). It owns the process
// lifecycle: ffmpeg is killed and reaped on any scan error or early stop,
// context cancellation wins, stderr is kept bounded, and a grandchild holding
// the pipe can't block Wait forever.
func streamMJPEG(ctx context.Context, ffmpegPath string, args []string, fn func(i int, raw []byte) error) error {
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	stderr := &tailBuffer{max: maxStderrBytes}
	cmd.Stderr = stderr
	cmd.WaitDelay = 5 * time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%w: %s", err, stderr.String())
	}

	scanErr := scanFrames(stdout, fn)
	stopped := errors.Is(scanErr, errStopScan)
	if scanErr != nil {
		// Stop ffmpeg so Wait returns promptly; the scan error is reported.
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()

	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if stopped {
		return nil
	}
	if scanErr != nil {
		return scanErr
	}
	if waitErr != nil {
		return fmt.Errorf("%w: %s", waitErr, stderr.String())
	}
	return nil
}

// scanFrames splits the MJPEG stream r into frames and calls fn(index, frame)
// for each; a frame that later fails to decode still consumes its index.
func scanFrames(r io.Reader, fn func(i int, raw []byte) error) error {
	sp := newFrameSplitter(r)
	for i := 0; ; i++ {
		raw, err := sp.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := fn(i, raw); err != nil {
			return err
		}
	}
}

func hashFrame(i int, raw []byte, fps float64) (hashedFrame, bool) {
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		return hashedFrame{}, false
	}
	h, err := goimagehash.PerceptionHash(img)
	if err != nil {
		return hashedFrame{}, false
	}
	return hashedFrame{timestamp: float64(i) / fps, hash: h}, true
}

// hashFrameStream reads an MJPEG stream from r, hashing each frame as it
// completes. A frame that fails to decode is skipped but still consumes its
// index, so timestamps stay frame-index / coarseFPS.
func hashFrameStream(r io.Reader) ([]hashedFrame, error) {
	var frames []hashedFrame
	err := scanFrames(r, func(i int, raw []byte) error {
		if f, ok := hashFrame(i, raw, coarseFPS); ok {
			frames = append(frames, f)
		}
		return nil
	})
	return frames, err
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
