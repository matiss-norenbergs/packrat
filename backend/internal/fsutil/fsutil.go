package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
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

// SanitizeRelativePath sanitizes a user-provided relative path made of one
// or more "/"-separated segments (e.g. a download's destination Folder),
// applying SanitizeFilename to each segment independently so a literal "/"
// in the input still expresses real nesting rather than being stripped
// along with the other unsafe characters. Segments that sanitize to "" (a
// blank segment, or a traversal attempt like "..") are dropped.
func SanitizeRelativePath(path string) string {
	var segments []string
	for _, seg := range strings.Split(path, "/") {
		if clean := SanitizeFilename(seg); clean != "" {
			segments = append(segments, clean)
		}
	}
	return strings.Join(segments, "/")
}

func EnsureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}

// RenameStep is one file of a multi-file rename (see RenameAll): Old is
// renamed to New. Label names the file in error messages ("media file",
// "thumbnail", "NFO sidecar"); it is optional.
type RenameStep struct {
	Old, New string
	Label    string
}

func (s RenameStep) label() string {
	if s.Label == "" {
		return "file"
	}
	return s.Label
}

// renameFile is os.Rename; tests replace it (SetRenameFuncForTest) to make a
// chosen rename fail and exercise the rollback.
var renameFile = os.Rename

// SetRenameFuncForTest replaces the function RenameAll renames with and
// returns a function that restores the previous one. Test-only.
func SetRenameFuncForTest(fn func(oldPath, newPath string) error) (restore func()) {
	prev := renameFile
	renameFile = fn
	return func() { renameFile = prev }
}

// CheckRenameDestinations reports whether every destination of steps is free,
// without renaming anything: the first occupied destination returns an error
// wrapping ErrDestinationExists (naming the step), any other stat failure
// returns that error. A step with an empty Old or New == Old moves nothing and
// is not checked. The destination is checked even when the step's source does
// not exist, so a missing thumbnail never lets the item silently adopt another
// file already sitting at the new thumbnail name.
func CheckRenameDestinations(steps []RenameStep) error {
	for _, st := range steps {
		if st.Old == "" || st.New == st.Old {
			continue
		}
		if _, err := os.Lstat(st.New); err == nil {
			return fmt.Errorf("renaming %s: %w", st.label(), ErrDestinationExists)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("checking destination %s: %w", st.label(), err)
		}
	}
	return nil
}

// RenameAll renames a media file together with its companion files (the
// thumbnail, the .nfo sidecar, ...) — used for both Rename (same directory,
// new base name) and Move (new directory, same base name), which are the same
// filesystem operation either way. steps[0] is the media file and must exist;
// the others are optional.
//
// Guarantees:
//   - every destination is checked (CheckRenameDestinations) BEFORE any rename;
//     an occupied one returns ErrDestinationExists and nothing is renamed;
//   - a step whose source does not exist when its turn comes (no .nfo, a
//     missing thumbnail, or a thumbnail that is the media file itself and was
//     just moved) is skipped, as are steps with an empty Old or New == Old;
//   - if a rename fails, the renames already done are undone in reverse order,
//     so the files are never split between the old and new locations (there is
//     no real filesystem transaction to fall back on; if an undo itself fails
//     the returned error says so).
func RenameAll(steps []RenameStep) error {
	if err := CheckRenameDestinations(steps); err != nil {
		return err
	}
	var done []RenameStep
	for i, st := range steps {
		if st.Old == "" || st.New == st.Old {
			continue
		}
		if i > 0 {
			if _, err := os.Lstat(st.Old); err != nil {
				continue // nothing to move
			}
		}
		if err := renameFile(st.Old, st.New); err != nil {
			err = fmt.Errorf("renaming %s: %w", st.label(), err)
			var rollbackErrs []string
			for j := len(done) - 1; j >= 0; j-- {
				if rbErr := renameFile(done[j].New, done[j].Old); rbErr != nil {
					rollbackErrs = append(rollbackErrs, fmt.Sprintf("%s: %v", done[j].label(), rbErr))
				}
			}
			if len(rollbackErrs) > 0 {
				return fmt.Errorf("%w (rollback also failed for %s)", err, strings.Join(rollbackErrs, "; "))
			}
			return err
		}
		done = append(done, st)
	}
	return nil
}

// maxUniqueAttempts bounds UniquePath's counter search.
const maxUniqueAttempts = 1000

// UniquePath returns path if nothing exists there, otherwise the first free
// "name (2).ext", "name (3).ext", ... (counter before the extension). After
// maxUniqueAttempts candidates it falls back to a time-based suffix so a
// caller never has to handle an error and never overwrites anything.
// Check-then-use is inherently racy; callers are the single-writer queue
// workers, which is acceptable.
func UniquePath(path string) string {
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 2; i <= maxUniqueAttempts; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if _, err := os.Lstat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return fmt.Sprintf("%s (%d)%s", stem, time.Now().UnixNano(), ext)
}
