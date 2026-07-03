package downloader

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type YtDlpService struct {
	BinPath    string
	FFmpegPath string
}

func NewYtDlpService(binPath, ffmpegPath string) *YtDlpService {
	return &YtDlpService{BinPath: binPath, FFmpegPath: ffmpegPath}
}

const metadataFetchTimeout = 30 * time.Second

// FetchMetadata runs `yt-dlp --dump-json` for url and parses the resulting
// JSON line into a Metadata struct. It does not download anything.
func (s *YtDlpService) FetchMetadata(ctx context.Context, url string) (*Metadata, error) {
	ctx, cancel := context.WithTimeout(ctx, metadataFetchTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, s.BinPath, "--dump-json", "--no-playlist", "--skip-download", "--no-warnings", url)
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
	args := s.BuildArgs(job)
	cmd := exec.CommandContext(ctx, s.BinPath, args...)

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
