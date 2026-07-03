package pathsafe

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

var ErrOutsideRoot = errors.New("path resolves outside the allowed root")

// ResolveUnderRoot cleans userSubpath and resolves it against root, refusing
// anything that would escape root — the sole defense against path traversal
// for user-provided folder/filename values (spec: "Path traversal prevention
// — all user-provided paths must resolve under configured media roots").
func ResolveUnderRoot(root, userSubpath string) (string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolving root: %w", err)
	}

	if strings.ContainsRune(userSubpath, 0) {
		return "", fmt.Errorf("%w: contains null byte", ErrOutsideRoot)
	}
	if filepath.IsAbs(userSubpath) {
		return "", fmt.Errorf("%w: absolute path not allowed", ErrOutsideRoot)
	}

	cleaned := filepath.Clean(userSubpath)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %q escapes root", ErrOutsideRoot, userSubpath)
	}

	joined := filepath.Join(root, cleaned)
	resolved, err := filepath.Abs(joined)
	if err != nil {
		return "", fmt.Errorf("resolving joined path: %w", err)
	}

	if resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %q resolves to %q", ErrOutsideRoot, userSubpath, resolved)
	}

	return resolved, nil
}
