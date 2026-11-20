package downloader

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// MaxFrameWindowSeconds bounds how long a [start, end) window the trim
// dialog's frame picker can request — decoding every frame only stays fast
// (and the resulting grid stays browsable) for a short window. The frontend
// mirrors this to proactively disable the picker rather than firing a
// request that's guaranteed to fail.
const MaxFrameWindowSeconds = 15.0

// maxFrameCount is a hard ceiling passed straight to ffmpeg (-frames:v) for
// full-resolution extraction (the frame matcher's path) — a safety net for
// unusually high frame-rate sources. Full-size frames are memory-heavy, so
// this stays low; the frame picker uses the much cheaper thumbnail path
// below and its own, higher cap.
const maxFrameCount = 300

// Thumbnail mode (the trim dialog's "Pick exact frame" grid). The grid draws
// each frame as a 110x70 tile, so frames are fit inside a box of 2x that
// (for high-DPI screens) at moderate JPEG quality instead of being sent at
// full video resolution.
const (
	// maxThumbFrameCount is the most thumbnails one window returns. 15 s at
	// 60 fps is 900 frames, so every realistic window fits.
	maxThumbFrameCount = 1000
	thumbMaxWidth      = 240
	thumbMaxHeight     = 150
	// thumbJPEGQuality is ffmpeg's -q:v (2 = near max, 31 = worst).
	thumbJPEGQuality = 5
)

// thumbVideoFilter fits a frame inside thumbMaxWidth x thumbMaxHeight,
// keeping the aspect ratio and never upscaling.
var thumbVideoFilter = fmt.Sprintf("scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", thumbMaxWidth, thumbMaxHeight)

const frameRangeTimeout = 30 * time.Second

// ExtractedFrame is one decoded frame from ExtractFrameRange.
type ExtractedFrame struct {
	TimestampSeconds float64
	ImageBase64      string
}

// FrameRangeResult is ExtractFrameThumbnails' output: the frames plus whether
// the window held more frames than were returned.
type FrameRangeResult struct {
	Frames      []ExtractedFrame
	Truncated   bool
	TotalFrames int // frames ffprobe lists in the window
}

// ExtractFrameRange decodes every frame in [start, end) at full video
// resolution and returns them in timestamp order — the "browse every frame,
// pick the exact one" mechanism for precise trim-point selection, sidestepping
// the browser <video> element's own (not reliably frame-accurate) seeking
// entirely. Callers that only display the frames should use
// ExtractFrameThumbnails instead.
func (s *YtDlpService) ExtractFrameRange(ctx context.Context, ffprobePath, mediaPath string, start, end float64) ([]ExtractedFrame, error) {
	r, err := s.extractFrames(ctx, ffprobePath, mediaPath, start, end, false)
	if err != nil {
		return nil, err
	}
	return r.Frames, nil
}

// ExtractFrameThumbnails is ExtractFrameRange for display: small, lower
// quality previews (see the thumb* constants), up to maxThumbFrameCount, with
// the result reporting whether the window was cut off.
func (s *YtDlpService) ExtractFrameThumbnails(ctx context.Context, ffprobePath, mediaPath string, start, end float64) (FrameRangeResult, error) {
	return s.extractFrames(ctx, ffprobePath, mediaPath, start, end, true)
}

func frameExtractArgs(mediaPath string, start, end float64, thumbs bool) []string {
	args := []string{"-y", "-ss", formatSeconds(start), "-i", mediaPath, "-t", formatSeconds(end - start), "-vsync", "0"}
	if thumbs {
		args = append(args, "-vf", thumbVideoFilter, "-frames:v", strconv.Itoa(maxThumbFrameCount), "-q:v", strconv.Itoa(thumbJPEGQuality))
	} else {
		args = append(args, "-frames:v", strconv.Itoa(maxFrameCount), "-q:v", "2")
	}
	return append(args, "-f", "image2pipe", "-vcodec", "mjpeg", "-")
}

func (s *YtDlpService) extractFrames(ctx context.Context, ffprobePath, mediaPath string, start, end float64, thumbs bool) (FrameRangeResult, error) {
	if end <= start {
		return FrameRangeResult{}, fmt.Errorf("end must be after start")
	}
	if end-start > MaxFrameWindowSeconds {
		return FrameRangeResult{}, fmt.Errorf("window too long: max %.0fs", MaxFrameWindowSeconds)
	}

	ctx, cancel := context.WithTimeout(ctx, frameRangeTimeout)
	defer cancel()

	timestamps := probeAllFrameTimestamps(ctx, ffprobePath, mediaPath, start, end-start)

	cmd := newTreeKillCmd(ctx, s.FFmpegPath, frameExtractArgs(mediaPath, start, end, thumbs)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return FrameRangeResult{}, fmt.Errorf("ffmpeg frame range extract failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	return pairFrames(timestamps, splitMJPEGStream(stdout.Bytes())), nil
}

// pairFrames pairs ffprobe's timestamps with ffmpeg's images by index (both
// are in presentation order), keeping min(len) of them. TotalFrames is how
// many frames ffprobe listed; Truncated is set when fewer than that were
// returned (ffmpeg's frame cap). With no timestamps (ffprobe failed) nothing
// is returned and nothing is reported as truncated.
func pairFrames(timestamps []float64, images [][]byte) FrameRangeResult {
	n := len(timestamps)
	if len(images) < n {
		n = len(images)
	}
	frames := make([]ExtractedFrame, n)
	for i := 0; i < n; i++ {
		frames[i] = ExtractedFrame{
			TimestampSeconds: timestamps[i],
			ImageBase64:      base64.StdEncoding.EncodeToString(images[i]),
		}
	}
	return FrameRangeResult{Frames: frames, Truncated: len(timestamps) > n, TotalFrames: len(timestamps)}
}

// ProbeFrameTimestamps returns the presentation timestamp of every video frame
// in [start, start+windowLen), in order (nil on any failure). Exported for the
// frame matcher, which decodes a window itself and needs the same timestamps
// ExtractFrameRange pairs its frames with.
func ProbeFrameTimestamps(ctx context.Context, ffprobePath, mediaPath string, start, windowLen float64) []float64 {
	return probeAllFrameTimestamps(ctx, ffprobePath, mediaPath, start, windowLen)
}

// probeAllFrameTimestamps lists every video frame's presentation timestamp
// within [start, start+windowLen) — the same ffprobe -read_intervals
// technique probeKeyframeTimestamps uses, just without the key_frame filter,
// since every frame (not only keyframes) is wanted here. Returns nil (never
// an error) on any failure, matching this file's other probe helpers.
//
// -read_intervals seeks to the nearest keyframe at or before start to begin
// decoding, then reports every frame it decodes from THAT point onward. With
// a "+DURATION" end (e.g. "12.000%+3.000"), ffprobe measures the duration
// from wherever that internal seek actually landed, not from start — so a
// window far from a keyframe silently returns frames from well before start
// and stops well before start+windowLen. Using an absolute end
// ("start%end") instead anchors the end to the real timeline, matching what
// callers actually mean by "everything in this window". Pre-roll frames
// before start still come back from the keyframe-snapped seek, and are
// filtered out below — the same defense the other -read_intervals consumers
// in this file (nearestKeyframeAtOrAfter/Before in trim.go) already apply.
func probeAllFrameTimestamps(ctx context.Context, ffprobePath, mediaPath string, start, windowLen float64) []float64 {
	ctx, cancel := context.WithTimeout(ctx, trimProbeTimeout)
	defer cancel()

	interval := fmt.Sprintf("%s%%%s", formatSeconds(start), formatSeconds(start+windowLen))
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet", "-select_streams", "v:0",
		"-show_entries", "frame=pts_time", "-read_intervals", interval,
		"-print_format", "json", mediaPath)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}

	var parsed struct {
		Frames []struct {
			PtsTime string `json:"pts_time"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil
	}

	end := start + windowLen
	result := make([]float64, 0, len(parsed.Frames))
	for _, f := range parsed.Frames {
		if v, err := strconv.ParseFloat(f.PtsTime, 64); err == nil && v >= start && v < end {
			result = append(result, v)
		}
	}
	return result
}

// splitMJPEGStream splits a concatenated stream of JPEG images (as produced
// by ffmpeg's "-f image2pipe -vcodec mjpeg -") into individual JPEG byte
// slices, by scanning for SOI (0xFFD8) / EOI (0xFFD9) marker pairs. This is
// the standard, reliable way to demux an MJPEG byte stream: JPEG's
// entropy-coded scan data always byte-stuffs any literal 0xFF byte with a
// following 0x00, so a raw 0xFFD9 outside that stuffing unambiguously marks
// the end of an image.
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
