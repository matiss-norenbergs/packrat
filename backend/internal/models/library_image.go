package models

import (
	"path/filepath"

	"packrat/backend/internal/fsutil"
)

// IsImageItem reports whether the item is a downloaded/imported image, whose
// "thumbnail" is the image file itself. The stored media type decides; only a
// row that predates the media_type column (nil or empty) falls back to the
// file extension, the same inference redownload uses.
func (i *LibraryItem) IsImageItem() bool {
	if i == nil {
		return false
	}
	if i.MediaType != nil && *i.MediaType != "" {
		return *i.MediaType == "image"
	}
	name := i.Filename
	if name == "" {
		name = filepath.Base(i.Path)
	}
	return fsutil.MediaTypeFromExtension(name) == "image"
}
