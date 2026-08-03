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

// maxFrameCount is a hard ceiling passed straight to ffmpeg (-frames:v) —
// a safety net for unusually high frame-rate sources (e.g. 120fps screen
// recordings) that could otherwise produce an unreasonable number of frames
// even within MaxFrameWindowSeconds.
const maxFrameCount = 300

const frameRangeTimeout = 30 * time.Second

// ExtractedFrame is one decoded frame from ExtractFrameRange.
type ExtractedFrame struct {
	TimestampSeconds float64
	ImageBase64      string
}

// ExtractFrameRange decodes every frame in [start, end) and returns them in
// timestamp order — the "browse every frame, pick the exact one" mechanism
// for precise trim-point selection, sidestepping the browser <video>
// element's own (not reliably frame-accurate) seeking entirely.
func (s *YtDlpService) ExtractFrameRange(ctx context.Context, ffprobePath, mediaPath string, start, end float64) ([]ExtractedFrame, error) {
	if end <= start {
		return nil, fmt.Errorf("end must be after start")
	}
	if end-start > MaxFrameWindowSeconds {
		return nil, fmt.Errorf("window too long: max %.0fs", MaxFrameWindowSeconds)
	}

	ctx, cancel := context.WithTimeout(ctx, frameRangeTimeout)
	defer cancel()

	timestamps := probeAllFrameTimestamps(ctx, ffprobePath, mediaPath, start, end-start)

	args := []string{
		"-y", "-ss", formatSeconds(start), "-i", mediaPath, "-t", formatSeconds(end - start),
		"-vsync", "0", "-frames:v", strconv.Itoa(maxFrameCount), "-q:v", "2",
		"-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := newTreeKillCmd(ctx, s.FFmpegPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg frame range extract failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	images := splitMJPEGStream(stdout.Bytes())
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
	return frames, nil
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
