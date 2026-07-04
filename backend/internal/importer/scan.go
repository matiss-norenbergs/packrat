package importer

import (
	"io/fs"
	"path/filepath"
	"strings"
)

// recognizedExtensions is the allowlist of media file types the scanner
// treats as importable. Thumbnail sidecars (.jpg/.png/.webp) and partial-
// download artifacts never match this list, so they're excluded from scan
// results without any special-casing.
var recognizedExtensions = map[string]bool{
	".mp4": true, ".mkv": true, ".webm": true, ".avi": true, ".mov": true, ".flv": true,
	".mp3": true, ".m4a": true, ".flac": true, ".wav": true, ".aac": true, ".ogg": true, ".opus": true,
}

// ScannedFile describes a media file found under a media root that isn't
// yet tracked in the library table.
type ScannedFile struct {
	RelPath        string // forward-slash path relative to the media root
	Filename       string
	SizeBytes      int64
	FolderSegments []string // path segments from the media root down to the containing directory; empty if the file sits at the root
}

// Scan walks mediaRoot for recognized media files whose relative path isn't
// present in known (already-tracked library paths, forward-slash). It's
// best-effort: unreadable entries are skipped rather than aborting the scan.
func Scan(mediaRoot string, known map[string]bool) ([]ScannedFile, error) {
	var out []ScannedFile

	err := filepath.WalkDir(mediaRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries, keep walking
		}
		if d.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(p))
		if !recognizedExtensions[ext] {
			return nil
		}

		rel, err := filepath.Rel(mediaRoot, p)
		if err != nil {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		if known[relSlash] {
			return nil
		}

		var size int64
		if info, err := d.Info(); err == nil {
			size = info.Size()
		}

		var segments []string
		if dir := filepath.Dir(rel); dir != "." {
			segments = strings.Split(filepath.ToSlash(dir), "/")
		}

		out = append(out, ScannedFile{
			RelPath:        relSlash,
			Filename:       filepath.Base(p),
			SizeBytes:      size,
			FolderSegments: segments,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// FilterIgnored drops any file whose containing folder — or any ancestor of
// it — exactly matches one of the ignored (forward-slash, relative to the
// media root) folder paths. Ignoring "Raw" also excludes "Raw/Subfolder",
// since every prefix of the file's folder chain is checked.
func FilterIgnored(files []ScannedFile, ignored []string) []ScannedFile {
	if len(ignored) == 0 {
		return files
	}
	ignoredSet := make(map[string]bool, len(ignored))
	for _, p := range ignored {
		ignoredSet[p] = true
	}

	out := make([]ScannedFile, 0, len(files))
	for _, f := range files {
		if !anyPrefixIgnored(f.FolderSegments, ignoredSet) {
			out = append(out, f)
		}
	}
	return out
}

func anyPrefixIgnored(segments []string, ignoredSet map[string]bool) bool {
	for i := range segments {
		if ignoredSet[strings.Join(segments[:i+1], "/")] {
			return true
		}
	}
	return false
}
