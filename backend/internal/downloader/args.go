package downloader

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// DownloadJob describes one yt-dlp invocation. DestDir must already be an
// absolute path validated to be under MediaRoot by the caller (pathsafe) —
// this package trusts it and does no further path-safety checks.
type DownloadJob struct {
	URL          string
	DestDir      string
	Filename     string // sanitized literal base filename, or "" to use yt-dlp's %(title)s
	DownloadType string // "video" | "audio"
	Quality      string // video quality tier, ignored for audio
	AudioFormat  string // "mp3" | "flac" | "m4a" | "aac" | "wav", required for audio
}

// BuildArgs returns the full yt-dlp argument list for job.
func (s *YtDlpService) BuildArgs(job DownloadJob) []string {
	base := job.Filename
	if base == "" {
		base = "%(title)s"
	}
	outputTemplate := filepath.Join(job.DestDir, base+".%(ext)s")

	args := []string{
		"--newline",
		"--no-warnings",
		"--progress",
		"--no-playlist",
		"--restrict-filenames",
		"--write-thumbnail",
		"--convert-thumbnails", "jpg",
		"--embed-metadata",
		"--ffmpeg-location", resolveFFmpegLocation(s.FFmpegPath),
		"--progress-template", ProgressTemplate,
		"--print", FilepathPrintTemplate,
		"-o", outputTemplate,
	}

	if job.DownloadType == "audio" {
		args = append(args, "-f", "bestaudio/best", "-x", "--audio-format", job.AudioFormat, "--audio-quality", "0")
	} else {
		args = append(args, "-f", BuildFormatSelector(job.Quality))
	}

	args = append(args, job.URL)
	return args
}

// resolveFFmpegLocation turns a bare command name (e.g. "ffmpeg", the
// config default) into the directory containing the resolved binary, since
// yt-dlp's --ffmpeg-location expects a real path — unlike normal subprocess
// execution, it does not itself perform a PATH lookup for bare names.
// Values that are already a path (contain a separator) are passed through
// unchanged.
func resolveFFmpegLocation(ffmpegPath string) string {
	if strings.ContainsAny(ffmpegPath, `/\`) {
		return ffmpegPath
	}
	resolved, err := exec.LookPath(ffmpegPath)
	if err != nil {
		return ffmpegPath
	}
	return filepath.Dir(resolved)
}
