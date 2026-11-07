package fsutil

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// EmbedTmpPrefix starts the name of every temp file EmbedMetadata creates.
// Dot-prefixed so it reads as internal, unique per run via os.CreateTemp.
const EmbedTmpPrefix = ".packrat-embed-"

// legacyEmbedTmpMarker is what the old fixed-name temp files carried before
// the extension: "<name>.packrat-tmp<ext>".
const legacyEmbedTmpMarker = ".packrat-tmp"

// IsEmbedTmpName reports whether a file name (no directory) is one of
// EmbedMetadata's temp files: the current ".packrat-embed-<digits><ext>" or
// the legacy "<name>.packrat-tmp<ext>". Exact shape only, no broad globbing.
func IsEmbedTmpName(name string) bool {
	ext := filepath.Ext(name)
	if ext == "" {
		return false
	}
	base := strings.TrimSuffix(name, ext)
	if rest, ok := strings.CutPrefix(base, EmbedTmpPrefix); ok && rest != "" {
		for _, r := range rest {
			if r < '0' || r > '9' {
				return false
			}
		}
		return true
	}
	return len(base) > len(legacyEmbedTmpMarker) && strings.HasSuffix(base, legacyEmbedTmpMarker)
}

// CleanStaleEmbedTemps best-effort removes abandoned EmbedMetadata temp files
// under root: regular files whose name IsEmbedTmpName and that were last
// modified more than olderThan ago (a crash or restart mid-remux leaves them
// behind). Returns how many were removed.
func CleanStaleEmbedTemps(root string, olderThan time.Duration) int {
	removed := 0
	cutoff := time.Now().Add(-olderThan)
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !d.Type().IsRegular() || !IsEmbedTmpName(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			return nil
		}
		if err := os.Remove(p); err != nil {
			log.Printf("embed cleanup: removing %s failed: %v", p, err)
			return nil
		}
		removed++
		return nil
	})
	return removed
}
