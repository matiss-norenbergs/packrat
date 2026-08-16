// Command framematch-bench measures how well a perceptual-hash frame
// matcher can relocate a "thumbnail" inside the video it came from.
//
// It never touches the app's database or media library — point it at any
// standalone video file. Each trial: pick a random true timestamp, extract
// that frame, degrade it (recompress/resize/optionally crop) to simulate
// the gap between a real video frame and a platform-served thumbnail, then
// run the two-phase matcher (coarse whole-video sweep + fine windowed
// refinement, reusing downloader.ExtractFrameRange for the latter) against
// the video with no knowledge of the true timestamp. A trial is a hit if
// the matcher lands within -tolerance seconds of the truth.
//
// This exists to pick real matcher defaults (hash size, coarse sample
// rate, top-K candidates) from measured hit rate/speed, not guesses,
// before any of this is wired into the app itself.
//
// Example:
//
//	go run ./cmd/framematch-bench -video /path/to/movie.mp4 -trials 20 -verbose
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"math/rand"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/corona10/goimagehash"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/importer"
)

func main() {
	video := flag.String("video", "", "path to a video file (required)")
	trials := flag.Int("trials", 10, "number of random trials to run")
	ffmpegPath := flag.String("ffmpeg", "ffmpeg", "path to ffmpeg binary")
	ffprobePath := flag.String("ffprobe", "ffprobe", "path to ffprobe binary")
	coarseMode := flag.String("coarse-mode", "keyframes", `coarse sweep strategy: "keyframes" (decode only I-frames, fast, GOP-limited granularity) or "fps" (full decode at -coarse-fps, thorough but much slower — useful as an accuracy baseline to compare against)`)
	coarseFPS := flag.Float64("coarse-fps", 1.0, "coarse whole-video sample rate, frames/sec (only used when -coarse-mode=fps)")
	topK := flag.Int("top-k", 3, "how many coarse candidates to refine in the fine pass")
	fineWindow := flag.Float64("fine-window", 3.0, "seconds wide, centered on each coarse candidate, for the fine pass (max 15)")
	tolerance := flag.Float64("tolerance", 1.0, "seconds of slack allowed between found and true timestamp to count as a hit")
	degradeWidth := flag.Uint("degrade-width", 320, "width (px) the true frame is resized to before hashing, simulating a served thumbnail")
	degradeQuality := flag.Int("degrade-quality", 8, "ffmpeg -q:v used when re-encoding the degraded thumbnail (2=best, 31=worst)")
	cropProb := flag.Float64("crop-prob", 0.5, "probability each trial also applies a slight off-center crop before hashing")
	seed := flag.Int64("seed", 0, "rng seed; 0 picks a time-based seed")
	verbose := flag.Bool("verbose", false, "print a line per trial, not just the summary")
	sweepTopK := flag.String("sweep-top-k", "", `comma-separated top-k values to compare, e.g. "3,6,10" — generates the trial cases once (same reference images for every value, for a fair comparison) and reports a hit-rate/time line per value instead of running a single config`)
	sweepFineWindow := flag.String("sweep-fine-window", "", `comma-separated fine-window values (seconds) to compare, e.g. "3,6,10,15" — same one-set-of-cases comparison as -sweep-top-k, but varying fine-window instead (top-k stays fixed at -top-k). Takes priority over -sweep-top-k if both are set.`)
	flag.Parse()

	if *video == "" {
		fmt.Fprintln(os.Stderr, "missing -video")
		flag.Usage()
		os.Exit(2)
	}
	if *fineWindow > downloader.MaxFrameWindowSeconds {
		fmt.Fprintf(os.Stderr, "-fine-window capped at %.0fs (downloader.MaxFrameWindowSeconds)\n", downloader.MaxFrameWindowSeconds)
		*fineWindow = downloader.MaxFrameWindowSeconds
	}
	if *coarseMode != "keyframes" && *coarseMode != "fps" {
		log.Fatalf(`-coarse-mode must be "keyframes" or "fps", got %q`, *coarseMode)
	}

	rngSeed := *seed
	if rngSeed == 0 {
		rngSeed = time.Now().UnixNano()
	}
	rng := rand.New(rand.NewSource(rngSeed))

	ctx := context.Background()
	probe := importer.Probe(ctx, *ffprobePath, *video)
	if probe.DurationSeconds == nil || *probe.DurationSeconds <= 0 {
		log.Fatalf("couldn't determine duration of %s (is ffprobe on PATH?)", *video)
	}
	duration := float64(*probe.DurationSeconds)
	fmt.Printf("video: %s (%.0fs)\n", *video, duration)
	fmt.Printf("params: coarse-mode=%s coarse-fps=%.2f top-k=%d fine-window=%.1fs tolerance=%.1fs degrade=%dpx/q%d crop-prob=%.2f seed=%d\n\n",
		*coarseMode, *coarseFPS, *topK, *fineWindow, *tolerance, *degradeWidth, *degradeQuality, *cropProb, rngSeed)

	ytdlpSvc := downloader.NewYtDlpService(*ffmpegPath, *ffmpegPath, "", nil, 1)

	m := &matcher{
		ytdlp:       ytdlpSvc,
		ffmpegPath:  *ffmpegPath,
		ffprobePath: *ffprobePath,
		video:       *video,
		coarseFPS:   *coarseFPS,
		topK:        *topK,
		fineWindow:  *fineWindow,
	}

	// The coarse sweep depends only on the video, not on any trial's
	// reference image — decoding the whole video once and reusing those
	// hashes across every trial is what makes running more than a couple
	// of trials practical. Re-running it per trial (the first cut of this
	// tool did) meant a ~10min video got fully re-decoded per trial.
	sweepStart := time.Now()
	var coarse []hashedFrame
	var sweepErr error
	if *coarseMode == "keyframes" {
		coarse, sweepErr = m.coarseSweepKeyframes(ctx)
	} else {
		coarse, sweepErr = m.coarseSweepFPS(ctx)
	}
	if sweepErr != nil {
		log.Fatalf("coarse sweep: %v", sweepErr)
	}
	m.coarse = coarse
	fmt.Printf("coarse sweep: %d frames in %v\n\n", len(coarse), time.Since(sweepStart).Round(time.Millisecond))

	// Generating the trial cases (pick a true timestamp, extract it,
	// degrade it into a "thumbnail") is independent of top-k/fine-window —
	// building the set once and reusing it across every value being
	// compared is both faster (skips re-extracting/re-degrading per value)
	// and a fairer comparison (every value is judged against the exact
	// same reference images, not a fresh random draw each time).
	fmt.Printf("generating %d trial cases...\n", *trials)
	cases := make([]trialCase, 0, *trials)
	for i := 0; i < *trials; i++ {
		tc, err := newTrialCase(ctx, m, rng, duration, *degradeWidth, *degradeQuality, *cropProb)
		if err != nil {
			fmt.Printf("case %2d: ERROR: %v\n", i+1, err)
			continue
		}
		cases = append(cases, tc)
	}
	fmt.Println()

	if *sweepFineWindow != "" {
		runSweepFineWindow(ctx, m, cases, *sweepFineWindow, *tolerance)
		return
	}
	if *sweepTopK != "" {
		runSweepTopK(ctx, m, cases, *sweepTopK, *tolerance)
		return
	}

	results := make([]trialResult, 0, len(cases))
	for i, tc := range cases {
		r, err := evaluateCase(ctx, m, tc, *tolerance)
		if err != nil {
			fmt.Printf("trial %2d: ERROR: %v\n", i+1, err)
			continue
		}
		results = append(results, r)
		if *verbose {
			hit := "MISS"
			if r.hit {
				hit = "HIT "
			}
			crop := ""
			if r.cropped {
				crop = " cropped"
			}
			fmt.Printf("trial %2d: %s  true=%6.1fs found=%6.1fs off=%5.2fs score=%5.1f%% %v%s\n",
				i+1, hit, r.trueTimestamp, r.foundTimestamp, r.foundTimestamp-r.trueTimestamp, r.score, r.elapsed.Round(time.Millisecond), crop)
		}
	}

	printSummary(results)
}

// sweepRow is one comparison line's stats — shared by both sweep kinds so
// neither duplicates the hit/score/time aggregation.
type sweepRow struct {
	hits, total        int
	hitScoreAvg        float64
	missScoreAvg       float64
	avgTime            time.Duration
	hasHits, hasMisses bool
}

// evalSweepRow evaluates every case against m's *current* topK/fineWindow
// (the caller sets whichever one is being swept beforehand) and aggregates
// the result into one row.
func evalSweepRow(ctx context.Context, m *matcher, cases []trialCase, tolerance float64) sweepRow {
	results := make([]trialResult, 0, len(cases))
	for _, tc := range cases {
		r, err := evaluateCase(ctx, m, tc, tolerance)
		if err != nil {
			continue
		}
		results = append(results, r)
	}

	row := sweepRow{total: len(results)}
	var hitScoreSum, missScoreSum float64
	var elapsedSum time.Duration
	for _, r := range results {
		elapsedSum += r.elapsed
		if r.hit {
			row.hits++
			hitScoreSum += r.score
			row.hasHits = true
		} else {
			missScoreSum += r.score
			row.hasMisses = true
		}
	}
	if row.hasHits {
		row.hitScoreAvg = hitScoreSum / float64(row.hits)
	}
	if row.hasMisses {
		row.missScoreAvg = missScoreSum / float64(row.total-row.hits)
	}
	if row.total > 0 {
		row.avgTime = (elapsedSum / time.Duration(row.total)).Round(time.Millisecond)
	}
	return row
}

func printSweepRow(label string, row sweepRow) {
	if row.total == 0 {
		fmt.Printf("%-8s no completed cases\n", label)
		return
	}
	fmt.Printf("%-8s %d/%d (%.0f%%)  %-16.1f %-16.1f %v\n",
		label, row.hits, row.total, 100*float64(row.hits)/float64(row.total),
		row.hitScoreAvg, row.missScoreAvg, row.avgTime)
}

// runSweepTopK evaluates the same trial cases once per value in the
// comma-separated topKList, mutating m.topK between passes (the coarse
// sweep and the cases themselves are untouched) and printing a comparison
// line per value.
func runSweepTopK(ctx context.Context, m *matcher, cases []trialCase, topKList string, tolerance float64) {
	fmt.Printf("%-8s %-10s %-16s %-16s %-10s\n", "top-k", "hit rate", "avg score(hit)", "avg score(miss)", "avg time")
	for _, raw := range strings.Split(topKList, ",") {
		raw = strings.TrimSpace(raw)
		k, err := strconv.Atoi(raw)
		if err != nil {
			fmt.Printf("skipping invalid -sweep-top-k value %q: %v\n", raw, err)
			continue
		}
		m.topK = k
		printSweepRow(strconv.Itoa(k), evalSweepRow(ctx, m, cases, tolerance))
	}
}

// runSweepFineWindow evaluates the same trial cases once per value in the
// comma-separated windowList (seconds), mutating m.fineWindow between
// passes and printing a comparison line per value. Values above
// downloader.MaxFrameWindowSeconds are capped, same as the single-config
// -fine-window flag.
func runSweepFineWindow(ctx context.Context, m *matcher, cases []trialCase, windowList string, tolerance float64) {
	fmt.Printf("%-8s %-10s %-16s %-16s %-10s\n", "window", "hit rate", "avg score(hit)", "avg score(miss)", "avg time")
	for _, raw := range strings.Split(windowList, ",") {
		raw = strings.TrimSpace(raw)
		w, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			fmt.Printf("skipping invalid -sweep-fine-window value %q: %v\n", raw, err)
			continue
		}
		if w > downloader.MaxFrameWindowSeconds {
			w = downloader.MaxFrameWindowSeconds
		}
		m.fineWindow = w
		printSweepRow(fmt.Sprintf("%.1fs", w), evalSweepRow(ctx, m, cases, tolerance))
	}
}

type trialResult struct {
	trueTimestamp  float64
	foundTimestamp float64
	distance       int
	score          float64 // 0-100, higher = closer match
	hit            bool
	cropped        bool
	elapsed        time.Duration
}

func printSummary(results []trialResult) {
	if len(results) == 0 {
		fmt.Println("no completed trials")
		return
	}
	var hits int
	var hitScoreSum, missScoreSum float64
	var elapsedSum time.Duration
	for _, r := range results {
		elapsedSum += r.elapsed
		if r.hit {
			hits++
			hitScoreSum += r.score
		} else {
			missScoreSum += r.score
		}
	}
	misses := len(results) - hits
	fmt.Printf("\n--- %d trials ---\n", len(results))
	fmt.Printf("hit rate:      %d/%d (%.0f%%)\n", hits, len(results), 100*float64(hits)/float64(len(results)))
	if hits > 0 {
		fmt.Printf("avg score (hits):  %.1f%%\n", hitScoreSum/float64(hits))
	}
	if misses > 0 {
		fmt.Printf("avg score (misses): %.1f%%\n", missScoreSum/float64(misses))
	}
	fmt.Printf("avg time/trial: %v\n", (elapsedSum / time.Duration(len(results))).Round(time.Millisecond))
}

// trialCase is a manufactured "thumbnail" (true timestamp + its degraded
// reference hash) — the part of a trial that's independent of which
// top-k/fine-window is being evaluated, so it can be built once and reused
// across every value a sweep compares.
type trialCase struct {
	trueTimestamp float64
	refHash       *goimagehash.ImageHash
	cropped       bool
}

// newTrialCase picks a random true timestamp, extracts that frame, and
// degrades it into a reference hash — everything a trial needs before
// matching begins.
func newTrialCase(ctx context.Context, m *matcher, rng *rand.Rand, duration float64, degradeWidth uint, degradeQuality int, cropProb float64) (trialCase, error) {
	trueTS := pickRandomTimestamp(duration, rng)

	trueFrameJPEG, err := extractSingleFrame(ctx, m.ffmpegPath, m.video, trueTS)
	if err != nil {
		return trialCase{}, fmt.Errorf("extract true frame: %w", err)
	}

	cropped := rng.Float64() < cropProb
	degraded, err := degradeThumbnail(ctx, m.ffmpegPath, trueFrameJPEG, degradeWidth, degradeQuality, cropped)
	if err != nil {
		return trialCase{}, fmt.Errorf("degrade thumbnail: %w", err)
	}

	refImg, err := jpeg.Decode(bytes.NewReader(degraded))
	if err != nil {
		return trialCase{}, fmt.Errorf("decode degraded thumbnail: %w", err)
	}
	refHash, err := goimagehash.PerceptionHash(refImg)
	if err != nil {
		return trialCase{}, fmt.Errorf("hash reference: %w", err)
	}

	return trialCase{trueTimestamp: trueTS, refHash: refHash, cropped: cropped}, nil
}

// evaluateCase runs the matcher (using m's current topK/fineWindow) against
// tc's reference hash and scores the result.
func evaluateCase(ctx context.Context, m *matcher, tc trialCase, tolerance float64) (trialResult, error) {
	start := time.Now()
	foundTS, distance, err := m.match(ctx, tc.refHash)
	elapsed := time.Since(start)
	if err != nil {
		return trialResult{}, fmt.Errorf("match: %w", err)
	}

	score := 100 * float64(tc.refHash.Bits()-distance) / float64(tc.refHash.Bits())
	hit := abs(foundTS-tc.trueTimestamp) <= tolerance

	return trialResult{
		trueTimestamp:  tc.trueTimestamp,
		foundTimestamp: foundTS,
		distance:       distance,
		score:          score,
		hit:            hit,
		cropped:        tc.cropped,
		elapsed:        elapsed,
	}, nil
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

// pickRandomTimestamp avoids the first/last 5% of the video, mirroring
// pickFrameTimestamps' reasoning in internal/api/thumbnail_handler.go —
// the very start is disproportionately likely to be a blank/logo frame,
// and ffmpeg can't seek to the literal end.
func pickRandomTimestamp(duration float64, rng *rand.Rand) float64 {
	lo := duration * 0.05
	hi := duration * 0.95
	if hi <= lo {
		return duration / 2
	}
	return lo + rng.Float64()*(hi-lo)
}

// matcher holds everything needed to locate a reference image's best
// matching frame inside one video: a coarse whole-video pHash sweep to
// find candidate neighborhoods, then a fine windowed pass (reusing
// downloader.ExtractFrameRange) to pin down the best frame within each.
type matcher struct {
	ytdlp       *downloader.YtDlpService
	ffmpegPath  string
	ffprobePath string
	video       string
	coarseFPS   float64
	topK        int
	fineWindow  float64

	// coarse is populated once by main() via coarseSweep before any trial
	// runs — see the comment at that call site for why this must not be
	// recomputed per trial.
	coarse []hashedFrame
}

type hashedFrame struct {
	timestamp float64
	hash      *goimagehash.ImageHash
}

// match returns the timestamp and Hamming distance of the best-matching
// frame found for refHash.
func (m *matcher) match(ctx context.Context, refHash *goimagehash.ImageHash) (float64, int, error) {
	if len(m.coarse) == 0 {
		return 0, 0, fmt.Errorf("matcher has no coarse sweep — call coarseSweep once before matching")
	}

	type scored struct {
		hashedFrame
		distance int
	}
	candidates := make([]scored, 0, len(m.coarse))
	for _, f := range m.coarse {
		d, err := refHash.Distance(f.hash)
		if err != nil {
			continue
		}
		candidates = append(candidates, scored{f, d})
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].distance < candidates[j].distance })

	k := m.topK
	if k > len(candidates) {
		k = len(candidates)
	}

	bestTS, bestDist := candidates[0].timestamp, candidates[0].distance
	covered := make([]struct{ lo, hi float64 }, 0, k)
	for i := 0; i < k; i++ {
		center := candidates[i].timestamp
		half := m.fineWindow / 2
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

		frames, err := m.ytdlp.ExtractFrameRange(ctx, m.ffprobePath, m.video, lo, hi)
		if err != nil || len(frames) == 0 {
			continue
		}
		for _, f := range frames {
			raw, err := decodeBase64JPEG(f.ImageBase64)
			if err != nil {
				continue
			}
			h, err := goimagehash.PerceptionHash(raw)
			if err != nil {
				continue
			}
			d, err := refHash.Distance(h)
			if err != nil {
				continue
			}
			if d < bestDist {
				bestDist = d
				bestTS = f.TimestampSeconds
			}
		}
	}

	return bestTS, bestDist, nil
}

// coarseSweepFPS decodes the whole video at m.coarseFPS via a single ffmpeg
// invocation producing an MJPEG stream, hashing every frame it contains.
// Frame i's timestamp is approximated as i/coarseFPS, which is only ever
// used to seed the fine pass's window, not as a final answer, so ffmpeg's
// fps filter's evenly-spaced output timing is accurate enough.
//
// This decodes every single frame of the source (the fps filter only
// throttles ffmpeg's *output*, not how much it has to decode to get
// there) — for a typical 24-30fps source that's 24-30x more decode work
// than coarseSweepKeyframes for the same wall-clock coverage. Kept around
// as the accuracy baseline -coarse-mode=fps runs against, since it's the
// densest possible sampling.
func (m *matcher) coarseSweepFPS(ctx context.Context) ([]hashedFrame, error) {
	args := []string{
		"-y", "-i", m.video,
		"-vf", fmt.Sprintf("fps=%f", m.coarseFPS),
		"-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	stream, err := runFFmpegCapture(ctx, m.ffmpegPath, args)
	if err != nil {
		return nil, fmt.Errorf("ffmpeg coarse sweep: %w", err)
	}

	images := splitMJPEGStream(stream)
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
		frames = append(frames, hashedFrame{timestamp: float64(i) / m.coarseFPS, hash: h})
	}
	return frames, nil
}

// coarseSweepKeyframes decodes only the video's I-frames via ffmpeg's
// -skip_frame nokey, skipping the (usually much larger) number of
// P/B-frames a full decode would otherwise have to sit through — this is
// what makes the coarse sweep fast enough to be practical on a full-length
// video. The tradeoff is coarser, GOP-interval-limited sampling (commonly
// every 2-10s) instead of a chosen fps, so it leans more heavily on the
// fine pass to find the exact frame once a keyframe neighborhood looks
// promising.
//
// ffmpeg's skip_frame output carries no per-frame timestamp in the
// image2pipe/mjpeg path, so timestamps are sourced separately via ffprobe
// (the same -read_intervals/key_frame technique
// internal/downloader/trim.go's probeKeyframeTimestamps uses, just
// unbounded) and paired positionally with the decoded images — both walk
// the keyframe sequence in the same order, so the i-th probed timestamp
// belongs to the i-th decoded image.
func (m *matcher) coarseSweepKeyframes(ctx context.Context) ([]hashedFrame, error) {
	timestamps, err := probeKeyframeTimestampsWhole(ctx, m.ffprobePath, m.video)
	if err != nil {
		return nil, fmt.Errorf("probe keyframe timestamps: %w", err)
	}
	if len(timestamps) == 0 {
		return nil, fmt.Errorf("no keyframes found")
	}

	args := []string{
		"-y", "-skip_frame", "nokey", "-i", m.video,
		"-vsync", "0", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	stream, err := runFFmpegCapture(ctx, m.ffmpegPath, args)
	if err != nil {
		return nil, fmt.Errorf("ffmpeg keyframe sweep: %w", err)
	}

	images := splitMJPEGStream(stream)
	n := len(images)
	if len(timestamps) < n {
		n = len(timestamps)
	}
	frames := make([]hashedFrame, 0, n)
	for i := 0; i < n; i++ {
		img, err := jpeg.Decode(bytes.NewReader(images[i]))
		if err != nil {
			continue
		}
		h, err := goimagehash.PerceptionHash(img)
		if err != nil {
			continue
		}
		frames = append(frames, hashedFrame{timestamp: timestamps[i], hash: h})
	}
	return frames, nil
}

// runFFmpegCapture runs ffmpeg and returns its full stdout — used for the
// coarse sweeps, where buffering the whole (tens-of-MB, not huge) MJPEG
// stream up front and splitting it with splitMJPEGStream is what actually
// works; see splitMJPEGStream's doc comment for why the seemingly simpler
// "call jpeg.Decode repeatedly on the same reader" trick isn't reliable
// here.
func runFFmpegCapture(ctx context.Context, ffmpegPath string, args []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, stderr.String())
	}
	return out, nil
}

// splitMJPEGStream splits a concatenated stream of JPEG images (as produced
// by ffmpeg's "-f image2pipe -vcodec mjpeg -") into individual JPEG byte
// slices, by scanning for SOI (0xFFD8) / EOI (0xFFD9) marker pairs.
//
// This exists because the more obvious approach — call jpeg.Decode
// repeatedly on the same *bufio.Reader, relying on it to stop exactly at
// each image's end — is NOT reliable for ffmpeg's MJPEG output in
// practice: the first frame decodes fine, but the reader ends up
// misaligned for the second (confirmed while building this tool: it fails
// with "invalid JPEG format: missing SOI marker" on frame 2 every time).
// internal/downloader/trim_frames.go's ExtractFrameRange hit the same
// problem and settled on this exact byte-scanning approach — ported here
// rather than exported from that package, since introducing a shared
// dependency for one small function wasn't worth it. JPEG's entropy-coded
// scan data always byte-stuffs any literal 0xFF byte with a following
// 0x00, so a raw 0xFFD9 outside that stuffing unambiguously marks the end
// of an image.
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
			break // unterminated final image — discard the partial trailing bytes
		}
	}
	return images
}

// probeKeyframeTimestampsWhole lists every I-frame's presentation
// timestamp across the entire video — an unbounded-range sibling of
// internal/downloader/trim.go's probeKeyframeTimestamps (unexported there,
// and always called with a bounded -read_intervals window, so not reused
// directly).
func probeKeyframeTimestampsWhole(ctx context.Context, ffprobePath, video string) ([]float64, error) {
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet", "-select_streams", "v:0",
		"-show_entries", "frame=pts_time,key_frame",
		"-print_format", "json", video)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var parsed struct {
		Frames []struct {
			PtsTime  string `json:"pts_time"`
			KeyFrame int    `json:"key_frame"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, err
	}

	timestamps := make([]float64, 0, len(parsed.Frames))
	for _, f := range parsed.Frames {
		if f.KeyFrame != 1 {
			continue
		}
		if v, err := strconv.ParseFloat(f.PtsTime, 64); err == nil {
			timestamps = append(timestamps, v)
		}
	}
	return timestamps, nil
}

// extractSingleFrame grabs one frame at approximately timestamp seconds —
// used only to manufacture this benchmark's "ground truth" frame, not part
// of the matcher itself.
func extractSingleFrame(ctx context.Context, ffmpegPath, video string, timestamp float64) ([]byte, error) {
	args := []string{
		"-y", "-ss", fmt.Sprintf("%f", timestamp), "-i", video,
		"-frames:v", "1", "-q:v", "2", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, stderr.String())
	}
	return out, nil
}

// degradeThumbnail simulates the gap between a raw video frame and a
// platform-served thumbnail: resize to a typical thumbnail width, an
// optional slight off-center crop (thumbnails are often cropped to a
// different aspect ratio than the source video), and re-encode through
// JPEG at a lower quality — real requantization drift, not a synthetic
// blur, since that's the actual failure mode a hash needs to survive.
func degradeThumbnail(ctx context.Context, ffmpegPath string, src []byte, width uint, quality int, crop bool) ([]byte, error) {
	filter := fmt.Sprintf("scale=%d:-2", width)
	if crop {
		filter = "crop=iw*0.9:ih*0.9," + filter
	}
	args := []string{
		"-y", "-i", "-",
		"-vf", filter, "-q:v", fmt.Sprintf("%d", quality),
		"-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	cmd.Stdin = bytes.NewReader(src)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, stderr.String())
	}
	return out, nil
}

func decodeBase64JPEG(b64 string) (image.Image, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	return jpeg.Decode(bytes.NewReader(data))
}
