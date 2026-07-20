//go:build !windows

package downloader

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup puts cmd's eventual process in its own process
// group, so killProcessTree can signal it and every child it spawns (ffmpeg,
// for format merges/metadata embeds/thumbnail conversion) together, instead
// of exec.CommandContext's default cancellation behavior of killing only
// the direct yt-dlp process and orphaning the rest of the tree.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessTree signals the whole process group cmd's process leads.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
