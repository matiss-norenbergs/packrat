package fsutil

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// ErrDestinationExists is returned by RenamePair when the target media or
// thumbnail path is already occupied by another file — renaming/moving over
// it would silently clobber that file's bytes while leaving whatever
// library row still points at it referencing now-wrong content.
var ErrDestinationExists = errors.New("destination already exists")

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

// RenamePair renames a media file and its companion thumbnail together —
// used for both Rename (same directory, new base name) and Move (new
// directory, same base name), which are the same filesystem operation
// either way. oldThumb/newThumb may be "" if there is no thumbnail. Both
// destinations are checked for a pre-existing file (returning
// ErrDestinationExists rather than silently overwriting it) before either
// rename is attempted. If the thumbnail rename fails after the media rename
// succeeded, the media file is renamed back so the two never end up split
// across old and new locations (there's no real filesystem transaction to
// fall back on).
func RenamePair(oldMedia, newMedia, oldThumb, newThumb string) error {
	if newMedia != oldMedia {
		if _, err := os.Stat(newMedia); err == nil {
			return fmt.Errorf("renaming media file: %w", ErrDestinationExists)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("checking destination media file: %w", err)
		}
	}
	if oldThumb != "" && newThumb != oldThumb {
		if _, err := os.Stat(newThumb); err == nil {
			return fmt.Errorf("renaming thumbnail: %w", ErrDestinationExists)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("checking destination thumbnail file: %w", err)
		}
	}

	if err := os.Rename(oldMedia, newMedia); err != nil {
		return fmt.Errorf("renaming media file: %w", err)
	}

	if oldThumb == "" {
		return nil
	}
	if _, err := os.Stat(oldThumb); err != nil {
		return nil // thumbnail already missing; nothing to rename
	}
	if err := os.Rename(oldThumb, newThumb); err != nil {
		if rollbackErr := os.Rename(newMedia, oldMedia); rollbackErr != nil {
			return fmt.Errorf("renaming thumbnail: %w (rollback of media rename also failed: %v)", err, rollbackErr)
		}
		return fmt.Errorf("renaming thumbnail: %w", err)
	}
	return nil
}
