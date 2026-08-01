package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"packrat/backend/internal/importer"
)

const trimTimeout = 10 * time.Minute
const trimProbeTimeout = 15 * time.Second

// keyframeEpsilon is how close a requested trim boundary needs to be to an
// actual keyframe before it's treated as already aligned — skipping the
// re-encoded boundary segment entirely in favor of a pure stream copy.
const keyframeEpsilon = 0.02

type videoInfo struct {
	VideoCodec string
	AudioCodec string
	FrameRate  float64
}

// probeVideoInfo shells to ffprobe for the source's video/audio codec names
// and video frame rate — best-effort, like importer.Probe: any failure just
// returns a zero-value videoInfo rather than an error, since the caller
// always has a sane fallback (ffmpeg's own default codec choice, or a fixed
// nudge-step when frame rate is unknown).
func probeVideoInfo(ctx context.Context, ffprobePath, mediaPath string) videoInfo {
	ctx, cancel := context.WithTimeout(ctx, trimProbeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet", "-print_format", "json", "-show_streams", mediaPath)
	out, err := cmd.Output()
	if err != nil {
		return videoInfo{}
	}

	var parsed struct {
		Streams []struct {
			CodecType  string `json:"codec_type"`
			CodecName  string `json:"codec_name"`
			RFrameRate string `json:"r_frame_rate"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return videoInfo{}
	}

	var info videoInfo
	for _, s := range parsed.Streams {
		switch s.CodecType {
		case "video":
			if info.VideoCodec == "" {
				info.VideoCodec = s.CodecName
			}
			if info.FrameRate == 0 {
				info.FrameRate = parseFrameRate(s.RFrameRate)
			}
		case "audio":
			if info.AudioCodec == "" {
				info.AudioCodec = s.CodecName
			}
		}
	}
	return info
}

// parseFrameRate parses ffprobe's r_frame_rate field, e.g. "30000/1001" or
// a plain "25". Returns 0 (never an error) if the value can't be parsed.
func parseFrameRate(s string) float64 {
	num, den, ok := strings.Cut(s, "/")
	if !ok {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0
		}
		return f
	}
	n, err1 := strconv.ParseFloat(num, 64)
	d, err2 := strconv.ParseFloat(den, 64)
	if err1 != nil || err2 != nil || d == 0 {
		return 0
	}
	return n / d
}

// preferredEncoderNames maps a few ffprobe codec_name values to the actual
// libavcodec ENCODER name needed to re-encode that codec — most codec names
// double as both decoder and encoder names, but a handful don't. Notably
// ffmpeg's native "opus" encoder is experimental-gated (fails unless
// -strict -2 is passed) even when the far more common "libopus" encoder is
// available and non-experimental; observed in practice against a real
// opus/webm trailer where the "opus" encoder silently produced zero audio
// packets and failed the whole segment.
var preferredEncoderNames = map[string]string{
	"opus":   "libopus",
	"mp3":    "libmp3lame",
	"vorbis": "libvorbis",
}

func preferredEncoderName(codecName string) string {
	if enc, ok := preferredEncoderNames[codecName]; ok {
		return enc
	}
	return codecName
}

// fastEncodeArgs returns extra speed-oriented ffmpeg args for encoders whose
// defaults are impractically slow for what's normally just a fraction of a
// second of re-encoded video at the trim boundary — libvpx-vp9's default
// "best" deadline, for instance, took over two minutes on a 4K clip in
// testing for well under a second of actual output. Quality loss from these
// settings is irrelevant here: this segment is a tiny sliver right at the
// cut, surrounded on both sides by lossless stream-copied video.
func fastEncodeArgs(encoderName string) []string {
	switch encoderName {
	case "libvpx-vp9", "vp9":
		return []string{"-deadline", "realtime", "-cpu-used", "8"}
	case "libaom-av1", "av1":
		return []string{"-cpu-used", "8"}
	case "libx264":
		return []string{"-preset", "ultrafast"}
	case "libx265":
		return []string{"-preset", "ultrafast"}
	default:
		return nil
	}
}

// ProbeFrameRate returns mediaPath's video frame rate (0 if it has no video
// stream, or ffprobe couldn't determine it) — used by the trim dialog to
// step the playhead forward/backward by exactly one frame.
func (s *YtDlpService) ProbeFrameRate(ctx context.Context, ffprobePath, mediaPath string) float64 {
	return probeVideoInfo(ctx, ffprobePath, mediaPath).FrameRate
}

func formatSeconds(t float64) string {
	return strconv.FormatFloat(t, 'f', 3, 64)
}

// probeKeyframeTimestamps lists the presentation timestamps of actual
// keyframes in the video stream within readIntervals (ffprobe's
// -read_intervals syntax, e.g. "12.000%+10") — a narrow window, not the
// whole file, so this stays fast even on long videos. Deliberately does NOT
// rely on ffprobe's "-skip_frame nokey" decoder hint to do the filtering:
// that hint isn't reliably honored for every codec (observed to silently
// pass through every frame for VP9/webm, which would make every frame look
// like a "keyframe" and corrupt the stream-copy boundary below) — instead
// every frame in the window is decoded and explicitly checked via the
// key_frame field. Returns nil (never an error) on any failure.
func probeKeyframeTimestamps(ctx context.Context, ffprobePath, mediaPath, readIntervals string) []float64 {
	ctx, cancel := context.WithTimeout(ctx, trimProbeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet", "-select_streams", "v:0",
		"-show_entries", "frame=pts_time,key_frame", "-read_intervals", readIntervals,
		"-print_format", "json", mediaPath)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}

	var parsed struct {
		Frames []struct {
			PtsTime  string `json:"pts_time"`
			KeyFrame int    `json:"key_frame"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil
	}

	result := make([]float64, 0, len(parsed.Frames))
	for _, f := range parsed.Frames {
		if f.KeyFrame != 1 {
			continue
		}
		if v, err := strconv.ParseFloat(f.PtsTime, 64); err == nil {
			result = append(result, v)
		}
	}
	return result
}

// nearestKeyframeAtOrAfter returns the smallest keyframe timestamp >= t,
// searching a 10-second window starting at t. ok is false if no keyframe
// was found in that window (e.g. an unusually long GOP) — the caller falls
// back to a plain re-encode of the whole kept range in that case.
func nearestKeyframeAtOrAfter(ctx context.Context, ffprobePath, mediaPath string, t float64) (float64, bool) {
	interval := fmt.Sprintf("%s%%+10", formatSeconds(t))
	best, ok := 0.0, false
	for _, kf := range probeKeyframeTimestamps(ctx, ffprobePath, mediaPath, interval) {
		if kf >= t && (!ok || kf < best) {
			best, ok = kf, true
		}
	}
	return best, ok
}

// nearestKeyframeAtOrBefore returns the largest keyframe timestamp <= t,
// searching a 10-second window ending at t.
func nearestKeyframeAtOrBefore(ctx context.Context, ffprobePath, mediaPath string, t float64) (float64, bool) {
	windowStart := t - 10
	if windowStart < 0 {
		windowStart = 0
	}
	interval := fmt.Sprintf("%s%%+%s", formatSeconds(windowStart), formatSeconds(t-windowStart+0.5))
	best, ok := 0.0, false
	for _, kf := range probeKeyframeTimestamps(ctx, ffprobePath, mediaPath, interval) {
		if kf <= t && (!ok || kf > best) {
			best, ok = kf, true
		}
	}
	return best, ok
}

// runTrimSegment runs a single ffmpeg pass over srcPath, keeping
// [start, end) (end nil means "to EOF"), writing outPath. copyMode uses
// -c copy (fast, lossless, requires start to already be a keyframe);
// otherwise it re-encodes using the source's own probed codecs (falling
// back to ffmpeg's container defaults when a codec couldn't be probed) so
// the result's stream parameters stay close enough to a stream-copied
// neighbor segment for the concat demuxer to join them cleanly.
//
// Deliberately uses "-t <duration>" rather than "-to <end>" throughout: for
// the re-encode path -ss is an input option (for fast/accurate seeking),
// which makes ffmpeg reset output timestamps to start near zero — an
// output-side "-to <end>" would then be measured against that reset clock
// (i.e. "end" seconds after the seek point, not "end" seconds into the
// original file), silently keeping far more of the file than intended. A
// duration is unambiguous regardless of the timestamp reset.
//
// copyMode places -ss as an OUTPUT option instead (after -i), unlike the
// re-encode path — confirmed by direct reproduction that input-side -ss
// combined with "-c copy" writes wrong duration metadata into the resulting
// Matroska/WebM container (observed: the container's reported duration came
// out unrelated to the actual trimmed content — in one repro exactly the
// full original length, in another an inconsistent partial overshoot —
// which then corrupts the final concatenated preview's duration too, and
// with it whatever a player derives its seek bar / total length from).
// Output-side -ss for a copy (no decoding either way) still seeks straight
// to the target keyframe with no measurable slowdown — this quirk is
// specific to combining -c copy with an *input-side* seek.
func runTrimSegment(ctx context.Context, ffmpegPath, srcPath, outPath string, start float64, end *float64, copyMode bool, info videoInfo) error {
	args := []string{"-y"}
	if !copyMode && start > 0 {
		args = append(args, "-ss", formatSeconds(start))
	}
	args = append(args, "-i", srcPath)
	if copyMode && start > 0 {
		args = append(args, "-ss", formatSeconds(start))
	}
	if end != nil {
		args = append(args, "-t", formatSeconds(*end-start))
	}
	args = append(args, "-map", "0")
	if copyMode {
		args = append(args, "-c", "copy")
	} else {
		if info.VideoCodec != "" {
			enc := preferredEncoderName(info.VideoCodec)
			args = append(args, "-c:v", enc)
			args = append(args, fastEncodeArgs(enc)...)
		}
		if info.AudioCodec != "" {
			args = append(args, "-c:a", preferredEncoderName(info.AudioCodec))
		}
	}
	args = append(args, outPath)

	cmd := newTreeKillCmd(ctx, ffmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		os.Remove(outPath)
		return fmt.Errorf("ffmpeg trim segment failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// concatSegments joins segments (already-written files, same codecs/params)
// into outPath via ffmpeg's concat demuxer with -c copy — no re-encoding at
// the join, since every segment's boundary is already either an original
// keyframe (stream-copied middle) or ends exactly where re-encoding placed
// it (boundary segments).
func concatSegments(ctx context.Context, ffmpegPath string, segments []string, outPath string) error {
	listPath := outPath + ".concat-list.txt"
	var sb strings.Builder
	for _, seg := range segments {
		escaped := strings.ReplaceAll(filepath.ToSlash(seg), "'", `'\''`)
		sb.WriteString(fmt.Sprintf("file '%s'\n", escaped))
	}
	if err := os.WriteFile(listPath, []byte(sb.String()), 0o644); err != nil {
		return fmt.Errorf("writing concat list: %w", err)
	}
	defer os.Remove(listPath)

	args := []string{"-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath}
	cmd := newTreeKillCmd(ctx, ffmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		os.Remove(outPath)
		return fmt.Errorf("ffmpeg concat failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// trimTmpDirName is a single shared scratch subfolder (directly under
// MediaRoot) — a dot-prefixed name so importer.Scan skips it (see scan.go)
// and so it doesn't visually clutter collection folders the way writing
// scratch files as siblings of the original did. Originally trim-only
// (preview/segment files), it's since also used by the redownload flow
// (queue/manager.go's completeRedownload) as a landing spot for a
// just-downloaded file before it's swapped over the original — same
// "write to shared scratch, only touch the original on confirmed success"
// shape, so it made more sense to reuse than to add a second folder.
const trimTmpDirName = ".packrat-tmp"

// TrimTmpDir returns the shared scratch directory under mediaRoot. It does
// not create the directory — callers that write into it (BuildTrimPreview,
// completeRedownload) are responsible for that.
func TrimTmpDir(mediaRoot string) string {
	return filepath.Join(mediaRoot, trimTmpDirName)
}

// BuildTrimPreview writes a trimmed copy of mediaAbsPath — keeping
// [trimStart, trimEnd] — to a new preview file under mediaRoot's shared
// TrimTmpDir, never touching the original. Kept on the same volume as
// mediaRoot (rather than a wholly separate temp root) deliberately: Accept
// finishes with an os.Rename over the original, which requires both paths
// to be on the same filesystem — a real constraint when MediaRoot points at
// a separate/network-mounted volume, a common self-hosted setup. At least
// one of trimStart/trimEnd must be set. Uses the "smart cut" technique:
// stream-copies the bulk of the kept range and only re-encodes right at
// each boundary that isn't already a keyframe. Falls back to a single
// whole-range re-encode when no valid keyframe split exists (e.g. the kept
// range is shorter than one GOP).
func (s *YtDlpService) BuildTrimPreview(ctx context.Context, ffprobePath, mediaAbsPath, mediaRoot string, trimStart, trimEnd *float64) (previewAbsPath string, durationSeconds int, fileSizeBytes int64, err error) {
	ctx, cancel := context.WithTimeout(ctx, trimTimeout)
	defer cancel()

	if trimStart == nil && trimEnd == nil {
		return "", 0, 0, fmt.Errorf("at least one of trimStart/trimEnd must be set")
	}

	effectiveStart := 0.0
	if trimStart != nil {
		effectiveStart = *trimStart
	}
	if effectiveStart < 0 {
		return "", 0, 0, fmt.Errorf("trim start must be >= 0")
	}
	if trimEnd != nil && *trimEnd <= effectiveStart {
		return "", 0, 0, fmt.Errorf("trim end must be after trim start")
	}

	needHead := trimStart != nil && effectiveStart > 0
	needTail := trimEnd != nil
	if !needHead && !needTail {
		return "", 0, 0, fmt.Errorf("nothing to trim")
	}

	dir := TrimTmpDir(mediaRoot)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, 0, fmt.Errorf("creating trim tmp dir: %w", err)
	}
	ext := filepath.Ext(mediaAbsPath)
	base := strings.TrimSuffix(filepath.Base(mediaAbsPath), ext)
	uid := strconv.FormatInt(time.Now().UnixNano(), 36)
	previewAbsPath = filepath.Join(dir, fmt.Sprintf("%s.trim-preview-%s%s", base, uid, ext))

	info := probeVideoInfo(ctx, ffprobePath, mediaAbsPath)

	segStart := effectiveStart
	var segEnd *float64
	if trimEnd != nil {
		e := *trimEnd
		segEnd = &e
	}

	splitOK := true
	createHeadSeg := false
	createTailSeg := false

	if needHead {
		kf, ok := nearestKeyframeAtOrAfter(ctx, ffprobePath, mediaAbsPath, effectiveStart)
		if !ok {
			splitOK = false
		} else {
			if kf-effectiveStart > keyframeEpsilon {
				createHeadSeg = true
			}
			segStart = kf
		}
	}
	if needTail && splitOK {
		kf, ok := nearestKeyframeAtOrBefore(ctx, ffprobePath, mediaAbsPath, *trimEnd)
		if !ok || kf <= segStart {
			splitOK = false
		} else {
			if *trimEnd-kf > keyframeEpsilon {
				createTailSeg = true
			}
			segEnd = &kf
		}
	}

	var segments []string
	cleanup := func() {
		for _, seg := range segments {
			os.Remove(seg)
		}
	}

	if !splitOK {
		if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, previewAbsPath, effectiveStart, trimEnd, false, info); err != nil {
			return "", 0, 0, err
		}
	} else {
		if createHeadSeg {
			segA := filepath.Join(dir, fmt.Sprintf("%s.trim-seg-a-%s%s", base, uid, ext))
			kf := segStart
			if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, segA, effectiveStart, &kf, false, info); err != nil {
				cleanup()
				return "", 0, 0, err
			}
			segments = append(segments, segA)
		}

		segB := filepath.Join(dir, fmt.Sprintf("%s.trim-seg-b-%s%s", base, uid, ext))
		if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, segB, segStart, segEnd, true, info); err != nil {
			cleanup()
			return "", 0, 0, err
		}
		segments = append(segments, segB)

		if createTailSeg {
			segC := filepath.Join(dir, fmt.Sprintf("%s.trim-seg-c-%s%s", base, uid, ext))
			tailStart := *segEnd
			if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, segC, tailStart, trimEnd, false, info); err != nil {
				cleanup()
				return "", 0, 0, err
			}
			segments = append(segments, segC)
		}

		if len(segments) == 1 {
			if err := os.Rename(segments[0], previewAbsPath); err != nil {
				cleanup()
				return "", 0, 0, fmt.Errorf("finalizing trim preview: %w", err)
			}
		} else {
			if err := concatSegments(ctx, s.FFmpegPath, segments, previewAbsPath); err != nil {
				cleanup()
				return "", 0, 0, err
			}
			cleanup()
		}
	}

	probe := importer.Probe(ctx, ffprobePath, previewAbsPath)
	if probe.DurationSeconds != nil {
		durationSeconds = *probe.DurationSeconds
	}
	fileSizeBytes = probe.SizeBytes
	return previewAbsPath, durationSeconds, fileSizeBytes, nil
}

// AcceptTrim overwrites mediaAbsPath with the already-generated preview at
// previewAbsPath — a same-volume rename, so it's atomic and near-instant
// regardless of file size.
func (s *YtDlpService) AcceptTrim(previewAbsPath, mediaAbsPath string) error {
	if err := os.Rename(previewAbsPath, mediaAbsPath); err != nil {
		return fmt.Errorf("replacing original file with trimmed version: %w", err)
	}
	return nil
}

// DiscardTrimPreview deletes a trim preview file. Missing-file is not an
// error — the dialog fires this best-effort on close, and the file may
// already be gone (e.g. a double discard).
func (s *YtDlpService) DiscardTrimPreview(previewAbsPath string) error {
	if err := os.Remove(previewAbsPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing trim preview: %w", err)
	}
	return nil
}
