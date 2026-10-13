// Package strayfiles finds files on disk that no DB record references and
// deletes them on request. Report-only until Delete is called.
//
// Every code path that writes under ImagesRoot (the inventory the ImagesRoot
// rules below must cover — a new writer means a new rule here):
//
//	library/<id>/<small|medium>/<uid>.webp  thumbnail tiers (library.thumbnail_small_path /
//	                                        thumbnail_medium_path) — written by SetLibraryThumbnail /
//	                                        writeThumbnailAndRespond, import, ghost/bulk thumbnail
//	                                        fetch, queue manager (download + redownload), AI
//	                                        enhancement, image backfill, subscription checker
//	library/<id>/original/<uuid>.jpg        AI-enhancement backup (thumbnail_enhancement_originals)
//	thumbnail-gallery/<libraryId>/<uuid>.*  gallery images (thumbnail_gallery.image_path)
//	frame-match/<queueId>/{found,reference}.jpg
//	                                        frame-match snapshots (frame_match_queue.found_frame_path /
//	                                        reference_image_path)
//	collections/<id>/<small|medium|original>/<uid>.webp
//	                                        cover tiers (collections.cover_image_*path)
//	artists/<id>/image/<uid>.webp           gallery images (artist_images.relative_path;
//	                                        artists.selected_image_path points at one of them)
//
// The resize cache lives under CACHE_ROOT (swept by imageproc.SweepCache) and
// any other top-level directory is not ours — both are never reported.
package strayfiles

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"packrat/backend/internal/pathsafe"
)

const (
	RootImages = "images"
	RootMedia  = "media"

	// MinAge protects files still being written by running jobs.
	MinAge = 10 * time.Minute

	ReasonUnreferenced  = "unreferenced file"
	ReasonOwnerDeleted  = "owner deleted"
	ReasonOrphanNFO     = "orphan .nfo sidecar"
	ReasonOrphanThumb   = "orphan thumbnail sidecar"
	ReasonTrimPreview   = "abandoned trim preview"
	ReasonPartialDownld = "abandoned partial download"
)

// ownedKinds maps each per-entity images/<kind>/ directory to the query that
// lists the ids of its owners. A <kind>/<id>/ dir whose id has no row is
// "owner deleted".
var ownedKinds = map[string]string{
	"library":           `SELECT id FROM library`,
	"thumbnail-gallery": `SELECT id FROM library`,
	"frame-match":       `SELECT id FROM frame_match_queue`,
	"collections":       `SELECT id FROM collections`,
	"artists":           `SELECT id FROM artists`,
}

// Jellyfin/Kodi artwork and metadata names that belong to the user, never to
// a deleted Packrat item.
var reservedStems = map[string]bool{
	"folder": true, "poster": true, "cover": true, "fanart": true, "backdrop": true,
	"banner": true, "logo": true, "thumb": true, "landscape": true, "clearart": true,
	"disc": true, "art": true, "movie": true, "tvshow": true, "season": true,
	"album": true, "artist": true,
}

type Config struct {
	DB         *sql.DB
	MediaRoot  string
	ImagesRoot string
}

type Entry struct {
	Root       string    `json:"root"`
	Path       string    `json:"path"`
	SizeBytes  int64     `json:"sizeBytes"`
	ModifiedAt time.Time `json:"modifiedAt"`
	Reason     string    `json:"reason"`
}

type Totals struct {
	Count int   `json:"count"`
	Bytes int64 `json:"bytes"`
}

type Result struct {
	Entries []Entry `json:"entries"`
	Totals  Totals  `json:"totals"`
}

type Ref struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

func key(root, p string) string { return root + "\x00" + p }

// Scan walks both roots and returns every stray entry. now is injected so the
// age cutoff is testable.
func Scan(ctx context.Context, cfg Config, now time.Time) (Result, error) {
	var entries []Entry

	imgEntries, err := scanImages(ctx, cfg, now)
	if err != nil {
		return Result{}, err
	}
	entries = append(entries, imgEntries...)

	mediaEntries, err := scanMedia(ctx, cfg, now)
	if err != nil {
		return Result{}, err
	}
	entries = append(entries, mediaEntries...)

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Root != entries[j].Root {
			return entries[i].Root < entries[j].Root
		}
		return entries[i].Path < entries[j].Path
	})
	res := Result{Entries: entries}
	if res.Entries == nil {
		res.Entries = []Entry{}
	}
	for _, e := range entries {
		res.Totals.Count++
		res.Totals.Bytes += e.SizeBytes
	}
	return res, nil
}

// Delete re-runs the stray check at delete time and removes only the
// requested refs that are still stray — the client list is never trusted.
// Each ref is resolved with pathsafe.ResolveUnderRoot. Returns how many were
// deleted and how many were skipped (no longer stray, unsafe, or failed).
func Delete(ctx context.Context, cfg Config, refs []Ref, now time.Time) (deleted, skipped int, err error) {
	fresh, err := Scan(ctx, cfg, now)
	if err != nil {
		return 0, 0, err
	}
	stray := make(map[string]bool, len(fresh.Entries))
	for _, e := range fresh.Entries {
		stray[key(e.Root, e.Path)] = true
	}

	for _, ref := range refs {
		rootDir, ok := rootDirFor(cfg, ref.Root)
		if !ok {
			skipped++
			continue
		}
		abs, rerr := pathsafe.ResolveUnderRoot(rootDir, filepath.FromSlash(ref.Path))
		if rerr != nil || abs == mustAbs(rootDir) {
			skipped++
			continue
		}
		rel, rerr := filepath.Rel(mustAbs(rootDir), abs)
		if rerr != nil || !stray[key(ref.Root, filepath.ToSlash(rel))] {
			skipped++
			continue
		}
		info, lerr := os.Lstat(abs)
		if lerr != nil {
			skipped++
			continue
		}
		if info.IsDir() {
			// Only "owner deleted" directories ever appear as entries.
			lerr = os.RemoveAll(abs)
		} else {
			lerr = os.Remove(abs)
		}
		if lerr != nil {
			log.Printf("stray files: failed to delete %s: %v", abs, lerr)
			skipped++
			continue
		}
		if ref.Root == RootImages { // never touch the user's media folders
			pruneEmptyParents(mustAbs(rootDir), filepath.Dir(abs))
		}
		deleted++
	}
	return deleted, skipped, nil
}

func rootDirFor(cfg Config, root string) (string, bool) {
	switch root {
	case RootImages:
		return cfg.ImagesRoot, cfg.ImagesRoot != ""
	case RootMedia:
		return cfg.MediaRoot, cfg.MediaRoot != ""
	}
	return "", false
}

func mustAbs(p string) string {
	a, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return a
}

// pruneEmptyParents removes now-empty directories above a deleted file, but
// never the root itself or its top-level directories. Stops at the first
// non-empty directory. Images root only.
func pruneEmptyParents(root, dir string) {
	for {
		rel, err := filepath.Rel(root, dir)
		if err != nil || rel == "." || !strings.Contains(rel, string(filepath.Separator)) {
			return // root or a top-level dir (images/<kind>)
		}
		if err := os.Remove(dir); err != nil { // fails if not empty
			return
		}
		dir = filepath.Dir(dir)
	}
}

func queryStrings(ctx context.Context, db *sql.DB, q string) ([]string, error) {
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("strayfiles: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s sql.NullString
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		if s.Valid && s.String != "" {
			out = append(out, s.String)
		}
	}
	return out, rows.Err()
}

func normRel(p string) string { return path.Clean(filepath.ToSlash(p)) }

func scanImages(ctx context.Context, cfg Config, now time.Time) ([]Entry, error) {
	if cfg.ImagesRoot == "" {
		return nil, nil
	}
	root := mustAbs(cfg.ImagesRoot)

	referenced := map[string]bool{}
	for _, q := range []string{
		`SELECT thumbnail_small_path FROM library`,
		`SELECT thumbnail_medium_path FROM library`,
		`SELECT original_path FROM thumbnail_enhancement_originals`,
		`SELECT image_path FROM thumbnail_gallery`,
		`SELECT found_frame_path FROM frame_match_queue`,
		`SELECT reference_image_path FROM frame_match_queue`,
		`SELECT cover_image_path FROM collections`,
		`SELECT cover_image_small_path FROM collections`,
		`SELECT cover_image_medium_path FROM collections`,
		`SELECT relative_path FROM artist_images`,
		`SELECT selected_image_path FROM artists`,
	} {
		paths, err := queryStrings(ctx, cfg.DB, q)
		if err != nil {
			return nil, err
		}
		for _, p := range paths {
			referenced[normRel(p)] = true
		}
	}

	owners := map[string]map[string]bool{}
	for kind, q := range ownedKinds {
		ids, err := queryStrings(ctx, cfg.DB, strings.Replace(q, "SELECT id", "SELECT CAST(id AS TEXT)", 1))
		if err != nil {
			return nil, err
		}
		set := make(map[string]bool, len(ids))
		for _, id := range ids {
			set[id] = true
		}
		owners[kind] = set
	}

	var out []Entry
	cutoff := now.Add(-MinAge)
	for kind := range ownedKinds {
		kindDir := filepath.Join(root, kind)
		children, err := os.ReadDir(kindDir)
		if err != nil {
			continue // kind dir doesn't exist yet
		}
		for _, child := range children {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			childRel := kind + "/" + child.Name()
			childAbs := filepath.Join(kindDir, child.Name())
			if child.Type()&fs.ModeSymlink != 0 {
				continue
			}

			if child.IsDir() && isNumeric(child.Name()) && !owners[kind][child.Name()] {
				size, newest, recent, count := dirStats(childAbs, cutoff)
				if count == 0 || recent {
					continue // empty dirs aren't reported; recent writes may be a running job
				}
				out = append(out, Entry{Root: RootImages, Path: childRel, SizeBytes: size, ModifiedAt: newest, Reason: ReasonOwnerDeleted})
				continue
			}

			walkFiles(childAbs, func(abs string, info fs.FileInfo) {
				rel, err := filepath.Rel(root, abs)
				if err != nil {
					return
				}
				rel = filepath.ToSlash(rel)
				if referenced[rel] || info.ModTime().After(cutoff) {
					return
				}
				out = append(out, Entry{Root: RootImages, Path: rel, SizeBytes: info.Size(), ModifiedAt: info.ModTime(), Reason: ReasonUnreferenced})
			})
		}
	}
	return out, nil
}

func isNumeric(s string) bool {
	_, err := strconv.ParseInt(s, 10, 64)
	return err == nil
}

// walkFiles calls fn for every regular file under dir (symlinks skipped).
func walkFiles(dir string, fn func(abs string, info fs.FileInfo)) {
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			log.Printf("stray files: walking %s: %v", p, err)
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		fn(p, info)
		return nil
	})
}

// dirStats totals a directory tree. recent reports whether any file was
// modified after cutoff (so a job may still be writing there).
func dirStats(dir string, cutoff time.Time) (size int64, newest time.Time, recent bool, count int) {
	walkFiles(dir, func(_ string, info fs.FileInfo) {
		count++
		size += info.Size()
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		if info.ModTime().After(cutoff) {
			recent = true
		}
	})
	return
}

func scanMedia(ctx context.Context, cfg Config, now time.Time) ([]Entry, error) {
	if cfg.MediaRoot == "" {
		return nil, nil
	}
	root := mustAbs(cfg.MediaRoot)

	// Library rows' media paths and sidecar thumbnails, as "dir/stem" keys and
	// exact paths, so a sidecar whose row still exists is never flagged even if
	// the media file is momentarily missing.
	refStems := map[string]bool{}
	refFiles := map[string]bool{}
	paths, err := queryStrings(ctx, cfg.DB, `SELECT path FROM library`)
	if err != nil {
		return nil, err
	}
	for _, p := range paths {
		p = normRel(p)
		refFiles[p] = true
		refStems[stemKey(p)] = true
	}
	thumbs, err := queryStrings(ctx, cfg.DB, `SELECT thumbnail FROM library`)
	if err != nil {
		return nil, err
	}
	for _, p := range thumbs {
		refFiles[normRel(p)] = true
	}

	type file struct {
		rel  string
		info fs.FileInfo
	}
	var files []file
	// stems that have a real (non-sidecar) file next to them, per directory.
	hasMedia := map[string]bool{}
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			log.Printf("stray files: walking %s: %v", p, err)
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		files = append(files, file{rel, info})
		if !isSidecarExt(rel) && !isTemp(rel) {
			hasMedia[stemKey(rel)] = true
		}
		return nil
	})
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	var out []Entry
	cutoff := now.Add(-MinAge)
	for _, f := range files {
		if f.info.ModTime().After(cutoff) {
			continue
		}
		reason := ""
		base := path.Base(f.rel)
		switch {
		case strings.Contains(base, ".trim-preview-"):
			reason = ReasonTrimPreview
		case strings.HasSuffix(base, ".part"):
			reason = ReasonPartialDownld
		case isSidecarExt(f.rel):
			stem := strings.TrimSuffix(base, path.Ext(base))
			if reservedStems[strings.ToLower(stem)] || refFiles[f.rel] || refStems[stemKey(f.rel)] || hasMedia[stemKey(f.rel)] {
				continue
			}
			if strings.EqualFold(path.Ext(base), ".nfo") {
				reason = ReasonOrphanNFO
			} else {
				reason = ReasonOrphanThumb
			}
		default:
			continue // media files without a row are "unimported" — the importer's job
		}
		out = append(out, Entry{Root: RootMedia, Path: f.rel, SizeBytes: f.info.Size(), ModifiedAt: f.info.ModTime(), Reason: reason})
	}
	return out, nil
}

func isSidecarExt(rel string) bool {
	switch strings.ToLower(path.Ext(rel)) {
	case ".nfo", ".jpg":
		return true
	}
	return false
}

func isTemp(rel string) bool {
	base := path.Base(rel)
	return strings.Contains(base, ".trim-preview-") || strings.HasSuffix(base, ".part")
}

// stemKey is "dir/name-without-extension".
func stemKey(rel string) string {
	return strings.TrimSuffix(rel, path.Ext(rel))
}
