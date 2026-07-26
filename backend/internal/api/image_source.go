package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"

	"packrat/backend/internal/pathsafe"
)

// resolveImageSourceBytes reads the bytes for a new gallery/cover image from
// exactly one of a dual source shared by artist images and collection
// covers: an existing on-disk file (sourceRelPath, resolved against
// mediaRoot) or a fresh base64 upload. Returns the bytes plus a filename
// hint to derive the destination extension from.
func resolveImageSourceBytes(mediaRoot string, sourceRelPath, imageBase64, filename *string) ([]byte, string, error) {
	switch {
	case sourceRelPath != nil && *sourceRelPath != "":
		abs, err := pathsafe.ResolveUnderRoot(mediaRoot, *sourceRelPath)
		if err != nil {
			return nil, "", fmt.Errorf("resolving source image path: %w", err)
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return nil, "", fmt.Errorf("reading source image: %w", err)
		}
		return data, *sourceRelPath, nil
	case imageBase64 != nil && *imageBase64 != "":
		data, err := base64.StdEncoding.DecodeString(*imageBase64)
		if err != nil {
			return nil, "", fmt.Errorf("invalid image data: %w", err)
		}
		name := ""
		if filename != nil {
			name = *filename
		}
		return data, name, nil
	default:
		return nil, "", errors.New("either sourceRelPath or imageBase64 must be set")
	}
}
