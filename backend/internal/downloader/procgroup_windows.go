//go:build windows

package downloader

import (
	"os/exec"
	"strconv"
)

// configureProcessGroup is a no-op on Windows — killProcessTree uses
// taskkill's /T (tree) flag instead of a process-group signal, so no
// special process creation flags are needed up front.
func configureProcessGroup(cmd *exec.Cmd) {}

// killProcessTree force-kills cmd's process and everything it spawned
// (ffmpeg, for format merges/metadata embeds/thumbnail conversion) via
// taskkill /T, since exec.CommandContext's default cancellation only kills
// the direct yt-dlp process and orphans the rest of the tree.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
}
