package downloader

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"packrat/backend/internal/repository"
)

type YtDlpService struct {
	BinPath      string
	FFmpegPath   string
	PipPath      string
	SettingsRepo *repository.SettingsRepo
}

func NewYtDlpService(binPath, ffmpegPath, pipPath string, settingsRepo *repository.SettingsRepo) *YtDlpService {
	return &YtDlpService{BinPath: binPath, FFmpegPath: ffmpegPath, PipPath: pipPath, SettingsRepo: settingsRepo}
}

// processTreeKillGrace bounds how long Wait() waits for killProcessTree's
// own kill signal/command to actually take effect before exec forcibly
// tears down the subprocess's I/O — a safety net, not the normal path.
const processTreeKillGrace = 10 * time.Second

// newTreeKillCmd builds a Cmd whose cancellation (ctx done, or the
// caller-imposed timeout below) kills the whole process tree rooted at it,
// not just the direct child — see procgroup_unix.go/procgroup_windows.go.
// Every yt-dlp/ffmpeg invocation in this file can spawn its own ffmpeg
// children (format merge, --embed-metadata, thumbnail conversion), which
// exec.CommandContext's default single-process kill would otherwise orphan
// on cancel/timeout.
func newTreeKillCmd(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	configureProcessGroup(cmd)
	cmd.Cancel = func() error { return killProcessTree(cmd) }
	cmd.WaitDelay = processTreeKillGrace
	return cmd
}

// metadataFetchTimeout is a ceiling, not a fixed wait — bumped from the
// single-video 30s baseline since --flat-playlist listing on very large
// playlists can take longer (still fast for the common single-video case).
const metadataFetchTimeout = 60 * time.Second

// FetchMetadata runs yt-dlp in playlist-aware, flat-extraction mode and
// parses the resulting single JSON object into a Metadata struct. It does
// not download anything. --dump-single-json always emits exactly one JSON
// object (a playlist's members nested under "entries") regardless of
// whether url is a single video or a playlist; --flat-playlist only affects
// how playlist *members* are extracted (shallow, no extra per-video network
// hit) — a bare single-video url is still fully extracted, so the
// single-video fields (title/uploader/duration/thumbnail/resolution) are
// unaffected. Check the result's IsPlaylist() to see which shape came back.
func (s *YtDlpService) FetchMetadata(ctx context.Context, url string) (*Metadata, error) {
	ctx, cancel := context.WithTimeout(ctx, metadataFetchTimeout)
	defer cancel()

	args := append([]string{"--dump-single-json", "--flat-playlist", "--skip-download", "--no-warnings"}, s.globalArgs(ctx)...)
	args = append(args, url)
	cmd := newTreeKillCmd(ctx, s.BinPath, args...)
	out, err := cmd.Output()
	if err != nil {
		if stderr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("yt-dlp metadata fetch failed: %w: %s", err, strings.TrimSpace(string(stderr.Stderr)))
		}
		return nil, fmt.Errorf("yt-dlp metadata fetch failed: %w", err)
	}

	var meta Metadata
	if err := json.Unmarshal(out, &meta); err != nil {
		return nil, fmt.Errorf("parsing yt-dlp metadata JSON: %w", err)
	}
	return &meta, nil
}

// FetchThumbnail downloads just the thumbnail image for url (no video/audio)
// into destDir as baseFilename.jpg, converting to jpg the same way real
// downloads do (see BuildArgs' --convert-thumbnails jpg), so imported
// thumbnails look identical to downloaded ones. Returns the written file's
// absolute path.
func (s *YtDlpService) FetchThumbnail(ctx context.Context, url, destDir, baseFilename string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, metadataFetchTimeout)
	defer cancel()

	outputTemplate := filepath.Join(destDir, baseFilename+".%(ext)s")
	args := []string{
		"--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg",
		"--no-playlist", "--no-warnings",
		"--ffmpeg-location", resolveFFmpegLocation(s.FFmpegPath),
		"-o", outputTemplate,
	}
	args = append(args, s.globalArgs(ctx)...)
	args = append(args, url)

	cmd := newTreeKillCmd(ctx, s.BinPath, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("yt-dlp thumbnail fetch failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	thumbPath := filepath.Join(destDir, baseFilename+".jpg")
	if _, err := os.Stat(thumbPath); err != nil {
		return "", fmt.Errorf("thumbnail not written: %w", err)
	}
	return thumbPath, nil
}

const metadataEmbedTimeout = 5 * time.Minute

// EmbedMetadata rewrites mediaPath in place — via a temp file in the same
// directory plus a rename over the original, so a failed remux never
// leaves the original file touched — with title/artist/year written into
// the container's own metadata tags. Uses -c copy so the audio/video
// stream itself is never re-encoded (fast, lossless); only the
// container-level tags change. artist/year/sequenceNumber/seasonNumber may
// be nil to simply not pass that tag — ffmpeg's default metadata passthrough
// (-map_metadata 0, implicit with -c copy) leaves any existing tag as-is
// when not overridden. seasonNumber is written as a plain "season" tag —
// unlike "track" (a genuinely standard field), this is only a real,
// player-recognized atom on MP4 (tvsn); on the Matroska/WebM containers
// Packrat mostly produces it's a free-form convention, same as sequence
// number's "track" tag.
func (s *YtDlpService) EmbedMetadata(ctx context.Context, mediaPath, title string, artist *string, year, sequenceNumber, seasonNumber *int) error {
	ctx, cancel := context.WithTimeout(ctx, metadataEmbedTimeout)
	defer cancel()

	ext := filepath.Ext(mediaPath)
	tmpPath := strings.TrimSuffix(mediaPath, ext) + ".packrat-tmp" + ext

	args := []string{"-y", "-i", mediaPath, "-map", "0", "-c", "copy", "-metadata", "title=" + title}
	if artist != nil {
		args = append(args, "-metadata", "artist="+*artist)
	}
	if year != nil {
		args = append(args, "-metadata", "date="+strconv.Itoa(*year))
	}
	if sequenceNumber != nil {
		args = append(args, "-metadata", "track="+strconv.Itoa(*sequenceNumber))
	}
	if seasonNumber != nil {
		args = append(args, "-metadata", "season_number="+strconv.Itoa(*seasonNumber))
	}
	args = append(args, tmpPath)

	cmd := newTreeKillCmd(ctx, s.FFmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("ffmpeg metadata embed failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	if err := os.Rename(tmpPath, mediaPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("replacing original file with re-tagged copy: %w", err)
	}
	return nil
}

const frameExtractTimeout = 30 * time.Second

// ExtractFrame grabs a single JPEG frame from mediaPath at atSeconds and
// returns the encoded image bytes directly — piped through ffmpeg's
// stdout, no temp file involved. Fails if mediaPath has no video stream.
func (s *YtDlpService) ExtractFrame(ctx context.Context, mediaPath string, atSeconds float64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, frameExtractTimeout)
	defer cancel()

	args := []string{
		"-y", "-ss", strconv.FormatFloat(atSeconds, 'f', 3, 64), "-i", mediaPath,
		"-frames:v", "1", "-q:v", "2", "-f", "image2", "-vcodec", "mjpeg", "-",
	}
	cmd := newTreeKillCmd(ctx, s.FFmpegPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg frame extract failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.Len() == 0 {
		return nil, fmt.Errorf("ffmpeg produced no frame data (no video stream?)")
	}
	return stdout.Bytes(), nil
}

// RunResult carries the outcome of a completed (successful or failed)
// download subprocess.
type RunResult struct {
	ExitCode   int
	FinalPath  string // captured from the PACKRAT-FILEPATH print line; empty if never seen
	StdoutTail string // last portion of stdout, capped
	StderrTail string // last portion of stderr, capped
	Command    string // the full command line, for debugging/logging
}

const logTailCap = 8000 // characters; caps stored stdout/stderr per the Logging Hygiene requirement

// Run executes yt-dlp for job. onProgress is called for each parsed
// progress line; onLogLine is called for every raw stdout/stderr line
// (including progress lines) so the caller can keep a capped tail for
// debugging. Run blocks until the subprocess exits or ctx is cancelled.
func (s *YtDlpService) Run(ctx context.Context, job DownloadJob, onProgress func(ProgressEvent)) (RunResult, error) {
	args := s.BuildArgs(ctx, job)
	cmd := newTreeKillCmd(ctx, s.BinPath, args...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return RunResult{}, fmt.Errorf("creating stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return RunResult{}, fmt.Errorf("creating stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return RunResult{}, fmt.Errorf("starting yt-dlp: %w", err)
	}

	var finalPath string
	var stdoutTail, stderrTail tailBuffer

	stdoutDone := make(chan struct{})
	go func() {
		defer close(stdoutDone)
		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			stdoutTail.Append(line)
			if ev, ok := ParseProgressLine(line); ok {
				if onProgress != nil {
					onProgress(ev)
				}
				continue
			}
			if path, ok := ParseFilepathLine(line); ok {
				finalPath = path
			}
		}
	}()

	stderrDone := make(chan struct{})
	go func() {
		defer close(stderrDone)
		scanner := bufio.NewScanner(stderrPipe)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			stderrTail.Append(scanner.Text())
		}
	}()

	<-stdoutDone
	<-stderrDone
	waitErr := cmd.Wait()

	result := RunResult{
		FinalPath:  finalPath,
		StdoutTail: stdoutTail.String(),
		StderrTail: stderrTail.String(),
		Command:    s.BinPath + " " + strings.Join(args, " "),
	}

	if waitErr != nil {
		if exitErr, ok := waitErr.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
			return result, nil
		}
		return result, fmt.Errorf("running yt-dlp: %w", waitErr)
	}

	result.ExitCode = 0
	return result, nil
}

// tailBuffer keeps only the last logTailCap characters appended to it,
// so long-running downloads with chatty output do not grow log storage
// unbounded (Logging & Storage Hygiene requirement).
type tailBuffer struct {
	b strings.Builder
}

func (t *tailBuffer) Append(line string) {
	t.b.WriteString(line)
	t.b.WriteByte('\n')
	if t.b.Len() > logTailCap {
		s := t.b.String()
		t.b.Reset()
		t.b.WriteString(s[len(s)-logTailCap:])
	}
}

func (t *tailBuffer) String() string {
	return t.b.String()
}
