package downloader

import (
	"strconv"
	"strings"
)

// progressLinePrefix marks lines emitted by our --progress-template so they
// can be distinguished from yt-dlp's normal human-readable log output on the
// same stdout stream.
const progressLinePrefix = "PACKRAT-PROGRESS:"

// filepathLinePrefix marks the line emitted by our --print directive that
// carries the final on-disk path once yt-dlp has moved the file into place.
const filepathLinePrefix = "PACKRAT-FILEPATH:"

// ProgressTemplate is passed to `yt-dlp --progress-template`. Fields are
// pipe-delimited in a fixed order (see ParseProgressLine). total_bytes is
// frequently "NA" for formats where the size isn't known upfront (chunked
// transfer), so total_bytes_estimate is included as a fallback.
const ProgressTemplate = progressLinePrefix +
	"%(progress.status)s|%(progress.filename)s|%(progress.downloaded_bytes)s|" +
	"%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|" +
	"%(progress.eta)s|%(progress._percent_str)s"

// FilepathPrintTemplate is passed to `yt-dlp --print after_move:...` so the
// authoritative final path can be captured regardless of container/extension
// changes made during postprocessing.
const FilepathPrintTemplate = "after_move:" + filepathLinePrefix + "%(filepath)s"

type ProgressEvent struct {
	Status           string // "downloading" | "finished"
	Filename         string
	DownloadedBytes  int64
	TotalBytes       int64 // 0 if unknown
	SpeedBytesPerSec float64
	ETASeconds       int // -1 if unknown
	Percent          float64
}

// ParseProgressLine parses one line of stdout. ok is false for lines that
// are not progress-template output (yt-dlp's normal log lines, warnings,
// etc.) so callers can safely feed it every line without filtering first.
func ParseProgressLine(line string) (ev ProgressEvent, ok bool) {
	line = strings.TrimSpace(line)
	rest, found := strings.CutPrefix(line, progressLinePrefix)
	if !found {
		return ProgressEvent{}, false
	}

	fields := strings.Split(rest, "|")
	if len(fields) != 8 {
		return ProgressEvent{}, false
	}

	ev.Status = fields[0]
	ev.Filename = fields[1]
	ev.DownloadedBytes = parseInt64OrZero(fields[2])
	ev.TotalBytes = parseInt64OrZero(fields[3])
	if ev.TotalBytes == 0 {
		ev.TotalBytes = parseInt64OrZero(fields[4]) // total_bytes_estimate fallback
	}
	ev.SpeedBytesPerSec = parseFloatOrZero(fields[5])
	if eta, isNA := parseETA(fields[6]); isNA {
		ev.ETASeconds = -1
	} else {
		ev.ETASeconds = eta
	}
	ev.Percent = parsePercent(fields[7])

	return ev, true
}

// ParseFilepathLine returns the final path and true if line is a
// PACKRAT-FILEPATH print line.
func ParseFilepathLine(line string) (path string, ok bool) {
	line = strings.TrimSpace(line)
	path, found := strings.CutPrefix(line, filepathLinePrefix)
	return path, found
}

func parseInt64OrZero(s string) int64 {
	if s == "" || s == "NA" {
		return 0
	}
	// yt-dlp emits byte counts as floats in some cases (e.g. "123.0").
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return int64(f)
}

func parseFloatOrZero(s string) float64 {
	if s == "" || s == "NA" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}

func parseETA(s string) (seconds int, isNA bool) {
	if s == "" || s == "NA" {
		return 0, true
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, true
	}
	return int(f), false
}

func parsePercent(s string) float64 {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, "%")
	s = strings.TrimSpace(s)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}
