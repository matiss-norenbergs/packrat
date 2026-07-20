package downloader

import (
	"context"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"packrat/backend/internal/models"
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
func (s *YtDlpService) BuildArgs(ctx context.Context, job DownloadJob) []string {
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
		// A thumbnail-fetch/convert failure is a postprocessing step, not a
		// real download failure — without -i, yt-dlp exits non-zero anyway
		// and the whole job gets marked failed even though the video itself
		// downloaded fine.
		"--ignore-errors",
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

	args = append(args, s.globalArgs(ctx)...)
	args = append(args, job.URL)
	return args
}

// globalArgs reads the user-configured cookies/proxy/rate-limit/retries
// settings and returns the corresponding yt-dlp flags. Any settings-read
// error (including a never-set key) is treated as "unset" rather than
// surfaced — same tolerant-default convention already used throughout
// settings_handler.go (e.g. ThumbnailFrameCount) — so a transient DB hiccup
// just means these optional flags are skipped for that one invocation
// rather than failing the whole download.
func (s *YtDlpService) globalArgs(ctx context.Context) []string {
	browser, _ := s.SettingsRepo.Get(ctx, models.SettingYtdlpCookiesBrowser)
	profile, _ := s.SettingsRepo.Get(ctx, models.SettingYtdlpCookiesProfile)
	proxy, _ := s.SettingsRepo.Get(ctx, models.SettingYtdlpProxy)
	rateLimit, _ := s.SettingsRepo.Get(ctx, models.SettingYtdlpRateLimit)
	retries, _ := s.SettingsRepo.Get(ctx, models.SettingYtdlpRetries)
	return buildGlobalArgs(browser, profile, proxy, rateLimit, retries)
}

// buildGlobalArgs turns the four global yt-dlp settings into their CLI
// flags. Blank/zero values mean "not configured" and are skipped, so
// leaving everything unset reproduces pre-existing flag-free behavior
// exactly. Pulled out as a pure function (no settings-repo access) so it's
// unit-testable without a DB, same extraction rationale as
// queue/manager.go's resolveFilename.
func buildGlobalArgs(cookiesBrowser, cookiesProfile, proxy, rateLimit, retries string) []string {
	var args []string
	if cookiesBrowser != "" {
		value := cookiesBrowser
		if cookiesProfile != "" {
			value += ":" + cookiesProfile
		}
		args = append(args, "--cookies-from-browser", value)
	}
	if proxy != "" {
		args = append(args, "--proxy", proxy)
	}
	if rateLimit != "" {
		args = append(args, "--limit-rate", rateLimit)
	}
	if n, err := strconv.Atoi(retries); err == nil && n > 0 {
		args = append(args, "--retries", retries, "--fragment-retries", retries)
	}
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
