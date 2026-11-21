package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"time"
)

// ProbeResult carries what ffprobe could determine about a local file.
// Zero-value fields mean the probe couldn't determine that piece — never
// treated as an error, since import must still succeed for an unprobeable
// file.
type ProbeResult struct {
	DurationSeconds *int
	Resolution      *string
	SizeBytes       int64
}

type ffprobeFormat struct {
	Duration string `json:"duration"`
	Size     string `json:"size"`
}

type ffprobeStream struct {
	CodecType string `json:"codec_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

type ffprobeOutput struct {
	Format  ffprobeFormat   `json:"format"`
	Streams []ffprobeStream `json:"streams"`
}

const probeTimeout = 15 * time.Second

// RoundDurationSeconds converts a probed length to the whole seconds stored on
// a library item: the nearest second (9.52 -> 10, 9.49 -> 9), never 0 for a
// positive length, because 0/NULL read as "unknown" and a 0.4 s clip is not.
func RoundDurationSeconds(d float64) int {
	n := int(math.Round(d))
	if n < 1 && d > 0 {
		return 1
	}
	return n
}

// Probe runs ffprobe against filePath to extract duration/resolution/size.
// Best-effort: any failure (missing binary, corrupt file, timeout) just
// returns a zero-value ProbeResult rather than an error.
func Probe(ctx context.Context, ffprobePath, filePath string) ProbeResult {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath)
	out, err := cmd.Output()
	if err != nil {
		return ProbeResult{}
	}

	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return ProbeResult{}
	}

	var result ProbeResult
	if d, err := strconv.ParseFloat(parsed.Format.Duration, 64); err == nil && d > 0 {
		seconds := RoundDurationSeconds(d)
		result.DurationSeconds = &seconds
	}
	for _, s := range parsed.Streams {
		if s.CodecType == "video" && s.Width > 0 && s.Height > 0 {
			res := fmt.Sprintf("%dx%d", s.Width, s.Height)
			result.Resolution = &res
			break
		}
	}
	if sz, err := strconv.ParseInt(parsed.Format.Size, 10, 64); err == nil {
		result.SizeBytes = sz
	}
	return result
}
