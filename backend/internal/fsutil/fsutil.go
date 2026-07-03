package fsutil

import (
	"os"
	"regexp"
	"strings"
)

// unsafeFilenameChars matches characters that are invalid or troublesome in
// filenames across Windows/Linux/macOS filesystems.
var unsafeFilenameChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

// SanitizeFilename strips path separators and filesystem-hostile characters
// from a user-provided literal filename, so it can never be used to write
// outside the resolved destination directory or break the target
// filesystem. Empty input (or input that sanitizes to empty) returns "".
func SanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	name = unsafeFilenameChars.ReplaceAllString(name, "")
	name = strings.Trim(name, " .")
	return name
}

func EnsureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}
