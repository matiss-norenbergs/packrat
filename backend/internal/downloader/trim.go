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
	// VideoTimescale is the denominator of the video stream's time_base
	// (e.g. 90000 for "1/90000"), 0 if unknown. See runTrimSegment's doc
	// comment for why a re-encoded boundary segment needs to be forced onto
	// this same timescale for MP4/MOV outputs.
	VideoTimescale int
}

// probeVideoInfo shells to ffprobe for the source's video/audio codec names,
// video frame rate, and video track timescale — best-effort, like
// importer.Probe: any failure just returns a zero-value videoInfo rather
// than an error, since the caller always has a sane fallback (ffmpeg's own
// default codec/timescale choice, or a fixed nudge-step when frame rate is
// unknown).
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
			TimeBase   string `json:"time_base"`
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
			if info.VideoTimescale == 0 {
				info.VideoTimescale = parseTimescale(s.TimeBase)
			}
		case "audio":
			if info.AudioCodec == "" {
				info.AudioCodec = s.CodecName
			}
		}
	}
	return info
}

// parseTimescale extracts the denominator from an ffprobe time_base string
// like "1/90000" — the numerator for a video stream's time_base is always 1
// in practice, so anything else is treated as unparseable (0, never an
// error) rather than risk passing a wrong timescale value to ffmpeg.
func parseTimescale(s string) int {
	num, den, ok := strings.Cut(s, "/")
	if !ok || num != "1" {
		return 0
	}
	d, err := strconv.Atoi(den)
	if err != nil || d <= 0 {
		return 0
	}
	return d
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

// mp4FamilyExts are extensions whose muxer honors ffmpeg's
// -video_track_timescale option (all handled by libavformat's movenc). Used
// by runTrimSegment to decide whether it's safe to pass that flag — passing
// it for a container that doesn't recognize it (e.g. Matroska/WebM) would
// just be a silently-ignored no-op at best, so this is a minor safety/clarity
// check rather than a strict requirement.
var mp4FamilyExts = map[string]bool{
	".mp4": true, ".m4v": true, ".m4a": true, ".mov": true,
}

// runTrimSegment runs a single ffmpeg pass over srcPath, re-encoding and
// keeping [start, end) (end nil means "to EOF"), writing outPath, using the
// source's own probed codecs (falling back to ffmpeg's container defaults
// when a codec couldn't be probed) so the result's stream parameters stay
// close enough to the concat-demuxer-joined copy portion for a clean join.
// Always re-encodes — it's only ever used for the small boundary slivers (a
// fraction of a second, right at a cut that isn't already a keyframe) and
// the whole-range fallback when no valid keyframe split exists. The bulk of
// the kept range is never routed through here: see concatSegments's doc
// comment for why it's referenced directly from the original file instead.
//
// Deliberately uses "-t <duration>" rather than "-to <end>": -ss is an
// input option here (for fast/accurate seeking), which makes ffmpeg reset
// output timestamps to start near zero — an output-side "-to <end>" would
// then be measured against that reset clock (i.e. "end" seconds after the
// seek point, not "end" seconds into the original file), silently keeping
// far more of the file than intended. A duration is unambiguous regardless
// of the timestamp reset.
//
// For MP4/MOV outputs, forces the re-encoded video track onto the SAME
// timescale as the original source (via -video_track_timescale) when it's
// known. Confirmed by direct reproduction to fix a real, severe corruption:
// without it, ffmpeg's mp4 muxer picks its own default timescale for this
// freshly re-encoded segment (typically derived from frame rate, e.g.
// 15360), different from the original source's own video timescale (e.g.
// 90000, common for h264 muxed from a 90kHz-clock pipeline). When
// concatSegments later joins this segment with a copy-mode portion that
// retains the source's original timescale, ffmpeg's mp4 muxer has to
// rescale between the two — and for B-frame-reordered packets specifically,
// that rescale silently drops the conversion for isolated DTS values,
// leaving them in the *source's* timescale instead of the output's. Because
// the ratio between the two timescales can be several-fold, one
// mis-rescaled packet is enough to inflate the whole container's declared
// duration by that same multiple (e.g. a 10-minute clip reporting itself as
// over an hour) even though the actual frame count/content is unaffected —
// this is a strictly worse variant of the same class of bug documented on
// concatSegments, and only reachable via the exact combination of
// (a) a trim point that isn't already a keyframe (needing this re-encoded
// sliver at all), (b) an MP4/MOV source, and (c) B-frames in the source's
// GOP structure — which is why it didn't surface during this fix's earlier
// verification passes (those either had a keyframe-aligned trim point, or a
// Matroska/WebM source, where no forced single-timescale muxing applies).
func runTrimSegment(ctx context.Context, ffmpegPath, srcPath, outPath string, start float64, end *float64, info videoInfo) error {
	args := []string{"-y"}
	if start > 0 {
		args = append(args, "-ss", formatSeconds(start))
	}
	args = append(args, "-i", srcPath)
	if end != nil {
		args = append(args, "-t", formatSeconds(*end-start))
	}
	args = append(args, "-map", "0")
	if info.VideoCodec != "" {
		enc := preferredEncoderName(info.VideoCodec)
		args = append(args, "-c:v", enc)
		args = append(args, fastEncodeArgs(enc)...)
	}
	if info.AudioCodec != "" {
		args = append(args, "-c:a", preferredEncoderName(info.AudioCodec))
	}
	if info.VideoTimescale > 0 && mp4FamilyExts[strings.ToLower(filepath.Ext(outPath))] {
		args = append(args, "-video_track_timescale", strconv.Itoa(info.VideoTimescale))
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

// concatEntry is one input to concatSegments: either a real segment file
// already trimmed to its exact final range (segA/segC, the re-encoded
// boundary slivers — no inpoint/outpoint needed), or a direct reference to
// the original source with inpoint/outpoint telling the concat demuxer
// which slice of it to use for the stream-copied portion.
type concatEntry struct {
	path     string
	inpoint  *float64
	outpoint *float64
}

// concatSegments joins entries into outPath via ffmpeg's concat demuxer
// with -c copy — no re-encoding at the join, since every entry is already
// either an original keyframe-aligned slice of the source or ends exactly
// where re-encoding placed it (segA/segC).
//
// The stream-copied portion is deliberately expressed as inpoint/outpoint
// directives against the ORIGINAL, untouched source file, rather than
// pre-cut into its own file via a separate "ffmpeg -ss <t> -i src -c copy
// out" pass (this codebase's first attempt at fixing a related bug — see
// CHANGELOG). That approach turned out to still be broken: confirmed by
// direct reproduction that this ffmpeg build's -ss (as either an input or
// output option) combined with -c copy is unreliable well beyond the
// original wrong-duration-metadata symptom — it was observed to silently
// drop several seconds of content from either end of the kept range, and in
// one case even seek to a completely different timestamp than the one
// requested, with no consistent relationship to the seek offset. The concat
// demuxer's own inpoint/outpoint handling against the untouched source, by
// contrast, was confirmed by direct reproduction (exact frame counts,
// correctly rebased timestamps starting at zero) to always produce exactly
// the requested slice, with no measurable slowdown (concat with -c copy
// never decodes, same as a plain copy would).
func concatSegments(ctx context.Context, ffmpegPath string, entries []concatEntry, outPath string) error {
	listPath := outPath + ".concat-list.txt"
	var sb strings.Builder
	for _, e := range entries {
		escaped := strings.ReplaceAll(filepath.ToSlash(e.path), "'", `'\''`)
		sb.WriteString(fmt.Sprintf("file '%s'\n", escaped))
		if e.inpoint != nil {
			sb.WriteString(fmt.Sprintf("inpoint %s\n", formatSeconds(*e.inpoint)))
		}
		if e.outpoint != nil {
			sb.WriteString(fmt.Sprintf("outpoint %s\n", formatSeconds(*e.outpoint)))
		}
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

	var tempFiles []string
	cleanup := func() {
		for _, f := range tempFiles {
			os.Remove(f)
		}
	}

	if !splitOK {
		if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, previewAbsPath, effectiveStart, trimEnd, info); err != nil {
			return "", 0, 0, err
		}
	} else {
		var entries []concatEntry

		if createHeadSeg {
			segA := filepath.Join(dir, fmt.Sprintf("%s.trim-seg-a-%s%s", base, uid, ext))
			kf := segStart
			if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, segA, effectiveStart, &kf, info); err != nil {
				cleanup()
				return "", 0, 0, err
			}
			tempFiles = append(tempFiles, segA)
			entries = append(entries, concatEntry{path: segA})
		}

		// The bulk of the kept range is never re-encoded or pre-cut into its
		// own file — it's referenced directly from the original source via
		// inpoint/outpoint. See concatSegments's doc comment for why.
		copyEntry := concatEntry{path: mediaAbsPath}
		if segStart > 0 {
			start := segStart
			copyEntry.inpoint = &start
		}
		if segEnd != nil {
			end := *segEnd
			copyEntry.outpoint = &end
		}
		entries = append(entries, copyEntry)

		if createTailSeg {
			segC := filepath.Join(dir, fmt.Sprintf("%s.trim-seg-c-%s%s", base, uid, ext))
			tailStart := *segEnd
			if err := runTrimSegment(ctx, s.FFmpegPath, mediaAbsPath, segC, tailStart, trimEnd, info); err != nil {
				cleanup()
				return "", 0, 0, err
			}
			tempFiles = append(tempFiles, segC)
			entries = append(entries, concatEntry{path: segC})
		}

		if err := concatSegments(ctx, s.FFmpegPath, entries, previewAbsPath); err != nil {
			cleanup()
			return "", 0, 0, err
		}
		cleanup()
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
