// Package nfo builds Jellyfin-readable .nfo sidecar files describing a
// library item's metadata — no I/O here, just XML construction; the API
// layer decides where to write the result.
package nfo

import (
	"encoding/xml"
	"os"
	"path/filepath"

	"packrat/backend/internal/models"
)

// SidecarPath returns the .nfo path for a media file — same basename, .nfo
// extension — mirroring thumbnailAbsPathFor's convention in the api
// package, which Jellyfin also expects for per-file sidecars.
func SidecarPath(mediaAbsPath string) string {
	ext := filepath.Ext(mediaAbsPath)
	return mediaAbsPath[:len(mediaAbsPath)-len(ext)] + ".nfo"
}

// WriteSidecar builds and writes item's .nfo sidecar next to mediaAbsPath,
// overwriting whatever is there. Shared by the manual "Generate NFO Now"
// action, every metadata-editing handler that keeps an opted-in item's NFO
// in sync, and the queue manager's download-time "Generate NFO" option.
func WriteSidecar(mediaAbsPath string, item models.LibraryItem, tags []string) error {
	doc := Build(item, tags)
	return os.WriteFile(SidecarPath(mediaAbsPath), doc, 0o644)
}

// episodeDetails uses Jellyfin/Kodi's <episodedetails> schema — the schema
// read for a per-file (not per-show) same-basename NFO, which matches
// Packrat's own flat, per-file library organization (see Jellyfin's "Home
// Videos"/"Mixed Content"/"Shows" library types, all of which read this
// per-episode form rather than a whole-directory <movie> NFO).
type episodeDetails struct {
	XMLName xml.Name `xml:"episodedetails"`
	Title   string   `xml:"title"`
	Plot    string   `xml:"plot,omitempty"`
	Year    *int     `xml:"year,omitempty"`
	Season  *int     `xml:"season,omitempty"`
	Episode *int     `xml:"episode,omitempty"`
	Studio  string   `xml:"studio,omitempty"`
	Tags    []string `xml:"tag,omitempty"`
}

// Build renders item (plus its tags, fetched separately since they live in
// a join table rather than on the model) as a complete .nfo XML document.
func Build(item models.LibraryItem, tags []string) []byte {
	doc := episodeDetails{
		Title:   item.Title,
		Year:    item.ReleaseYear,
		Season:  item.SeasonNumber,
		Episode: item.SequenceNumber,
		Tags:    tags,
	}
	if item.Description != nil {
		doc.Plot = *item.Description
	}
	if item.Uploader != nil {
		doc.Studio = *item.Uploader
	}

	// Marshaling a plain struct of strings/ints/slices with no cycles never
	// fails, so a returned error here would indicate a programming mistake
	// (e.g. an unmarshalable field type), not a runtime condition to handle.
	out, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		panic(err)
	}
	return append([]byte(xml.Header), out...)
}
