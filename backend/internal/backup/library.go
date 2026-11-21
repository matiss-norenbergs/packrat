package backup

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

type CollectionEntry struct {
	Path                []string `json:"path"` // root-path segments, root->leaf
	Name                string   `json:"name"`
	DefaultQuality      string   `json:"defaultQuality"`
	DefaultDownloadType string   `json:"defaultDownloadType"`
	IsPrivate           bool     `json:"isPrivate"`
	JellyfinLibrary     *string  `json:"jellyfinLibrary,omitempty"`
	SeasonNumber        *int     `json:"seasonNumber,omitempty"`
	// ArtistName is a name reference, not the raw local ArtistID — like
	// LibraryItemEntry.ArtistName, a numeric id means nothing on a different
	// install, so this round-trips through the artist's name instead.
	ArtistName string `json:"artistName,omitempty"`
}

// TagEntry is a tag definition in the library bundle — as opposed to a
// LibraryItemEntry's/ResolvedDownload's plain []string Tags, which are just
// the names assigned to that one item. This carries the tag's own
// attributes (currently just IsPrivate) so re-importing a bundle restores
// which tags blur their items, the same way CollectionEntry carries
// IsPrivate for collections.
type TagEntry struct {
	Name      string `json:"name"`
	IsPrivate bool   `json:"isPrivate,omitempty"`
}

// ArtistEntry is an artist definition in the library bundle: name, private
// flag and birthday, and nothing else — images stay out on purpose (backups
// carry references, never file bytes). Items and collections still reference
// artists by name (ArtistName).
type ArtistEntry struct {
	Name      string `json:"name"`
	IsPrivate bool   `json:"isPrivate,omitempty"`
	// Birthday is the date-only string "YYYY-MM-DD" (see models.Artist.Birthday).
	Birthday string `json:"birthday,omitempty"`
}

// UnmarshalJSON accepts both the current object form and the bare name string
// older backups used for artists, deciding per element from its first byte.
func (a *ArtistEntry) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if len(b) > 0 && b[0] == '"' {
		*a = ArtistEntry{}
		return json.Unmarshal(b, &a.Name)
	}
	type plain ArtistEntry // no methods, so no recursion into this function
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*a = ArtistEntry(p)
	return nil
}

// validBirthday reports whether s is a real calendar date in YYYY-MM-DD form.
func validBirthday(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

type LibraryItemEntry struct {
	Title          string   `json:"title"` // informational only, not used on import
	OriginalURL    string   `json:"originalUrl"`
	CollectionPath []string `json:"collectionPath,omitempty"` // empty/absent = uncategorized
	Folder         string   `json:"folder"`
	Filename       string   `json:"filename"`
	DownloadType   string   `json:"downloadType,omitempty"`
	Quality        string   `json:"quality,omitempty"`
	AudioFormat    string   `json:"audioFormat,omitempty"`
	ArtistName     string   `json:"artistName,omitempty"`
	Year           *int     `json:"year,omitempty"`
	SequenceNumber *int     `json:"sequenceNumber,omitempty"`
	SeasonNumber   *int     `json:"seasonNumber,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	// Status is "ghost" for a placeholder item with no downloaded file, or
	// omitted for a normal completed item — informational only on import
	// (see ApplyLibraryBundle): what actually decides ghost-vs-download
	// there is whether OriginalURL is empty and the caller's ghostOnly
	// flag, not this field, since a ghost with a saved URL is just as
	// downloadable as any other item.
	Status string `json:"status,omitempty"`
	// MediaType records a ghost item's video/audio type, since a ghost has
	// no resolution/download-type signal to infer it from otherwise (see
	// models.LibraryItem.MediaType). Only meaningful when Status is "ghost".
	MediaType string `json:"mediaType,omitempty"`
}

type LibraryBundle struct {
	Collections  []CollectionEntry  `json:"collections"`
	Tags         []TagEntry         `json:"tags"`
	Artists      []ArtistEntry      `json:"artists"`
	LibraryItems []LibraryItemEntry `json:"libraryItems"`
}

// collectionPaths maps every collection's ID to its root-to-leaf chain of
// RootPath segments, so the exported bundle can reference collections by
// path instead of a numeric ID that means nothing on a different install.
func collectionPaths(cols []models.Collection) map[int64][]string {
	byID := make(map[int64]models.Collection, len(cols))
	for _, c := range cols {
		byID[c.ID] = c
	}

	paths := make(map[int64][]string, len(cols))
	var pathFor func(id int64) []string
	pathFor = func(id int64) []string {
		if p, ok := paths[id]; ok {
			return p
		}
		c := byID[id]
		var p []string
		if c.ParentID != nil {
			p = append(p, pathFor(*c.ParentID)...)
		}
		p = append(p, c.RootPath)
		paths[id] = p
		return p
	}
	for id := range byID {
		pathFor(id)
	}
	return paths
}

// BuildLibraryBundle collects tags, collections, artists, and every library
// item — everything needed to reconstruct the library elsewhere, without
// shipping any actual media file bytes. Items with a saved originalUrl
// round-trip by re-queueing a download; items without one (an already-ghost
// row, or a real file that was locally imported without ever having a
// source URL) round-trip as a ghost placeholder instead, since there's no
// URL to redownload from.
func BuildLibraryBundle(
	ctx context.Context,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	downloadsRepo *repository.DownloadsRepo,
) (LibraryBundle, error) {
	var bundle LibraryBundle

	artistRows, err := artistsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	artistNames := make(map[int64]string, len(artistRows))
	for _, a := range artistRows {
		entry := ArtistEntry{Name: a.Name, IsPrivate: a.IsPrivate}
		if a.Birthday != nil {
			entry.Birthday = *a.Birthday
		}
		bundle.Artists = append(bundle.Artists, entry)
		artistNames[a.ID] = a.Name
	}

	cols, err := collectionsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	paths := collectionPaths(cols)
	for _, c := range cols {
		entry := CollectionEntry{
			Path:                paths[c.ID],
			Name:                c.Name,
			DefaultQuality:      c.DefaultQuality,
			DefaultDownloadType: c.DefaultDownloadType,
			IsPrivate:           c.IsPrivate,
			JellyfinLibrary:     c.JellyfinLibrary,
			SeasonNumber:        c.SeasonNumber,
		}
		if c.ArtistID != nil {
			entry.ArtistName = artistNames[*c.ArtistID]
		}
		bundle.Collections = append(bundle.Collections, entry)
	}

	tagRows, err := tagsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	for _, t := range tagRows {
		bundle.Tags = append(bundle.Tags, TagEntry{Name: t.Name, IsPrivate: t.IsPrivate})
	}

	items, err := libraryRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	// Every item is exported, not just ones with a saved URL — one with
	// neither a URL nor ghost status (e.g. a locally-imported file) still
	// round-trips, just as a ghost placeholder on import (see
	// ApplyLibraryBundle) rather than a redownload.
	filtered := items
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	tagsByItem, err := tagsRepo.TagsByLibraryIDs(ctx, ids)
	if err != nil {
		return bundle, err
	}

	var downloadIDs []int64
	for _, it := range filtered {
		if it.DownloadID != nil {
			downloadIDs = append(downloadIDs, *it.DownloadID)
		}
	}
	downloadsByID, err := downloadsRepo.GetByIDs(ctx, downloadIDs)
	if err != nil {
		return bundle, err
	}

	for _, it := range filtered {
		entry := LibraryItemEntry{
			Title:          it.Title,
			Folder:         it.Folder,
			Filename:       it.Filename,
			Year:           it.ReleaseYear,
			SequenceNumber: it.SequenceNumber,
			SeasonNumber:   it.SeasonNumber,
			Tags:           tagsByItem[it.ID],
		}
		if it.OriginalURL != nil {
			entry.OriginalURL = *it.OriginalURL
		}
		if it.Status == "ghost" {
			entry.Status = "ghost"
			if it.MediaType != nil {
				entry.MediaType = *it.MediaType
			}
		}
		if it.ArtistName != nil {
			entry.ArtistName = *it.ArtistName
		}
		if it.CollectionID != nil {
			entry.CollectionPath = paths[*it.CollectionID]
		}
		// Quality/type/audio format live on the originating Download row, not
		// LibraryItem itself — omit them (importer falls back to defaults)
		// when that row is gone, same as RedownloadLibraryItem already does.
		if it.DownloadID != nil {
			if dl, ok := downloadsByID[*it.DownloadID]; ok {
				entry.DownloadType = dl.DownloadType
				entry.Quality = dl.Quality
				if dl.AudioFormat != nil {
					entry.AudioFormat = *dl.AudioFormat
				}
			}
		}
		bundle.LibraryItems = append(bundle.LibraryItems, entry)
	}

	return bundle, nil
}

// cleanCollectionSegment returns the form of one collection path segment from
// an uploaded bundle that a normal collection create would accept. A segment
// that is already a single safe path element (non-empty, not "." or "..", no
// separator, NUL or control character, contained under a root) is returned
// unchanged, so collections that exist locally with an unusual but valid
// name (for example one created by a folder scan) still match exactly.
// Anything else goes through fsutil.SanitizeFilename, the same cleaning the
// collection create/update handlers apply to rootPath ("a/b" becomes "ab",
// ".." becomes ""). ok is false when nothing is left.
func cleanCollectionSegment(seg string) (clean string, ok bool) {
	if seg != "" && seg != "." && seg != ".." && !strings.ContainsAny(seg, "/\\\x00") && fsutil.SanitizeExistingFilename(seg) != "" &&
		strings.IndexFunc(seg, func(r rune) bool { return r < 0x20 }) < 0 {
		if _, err := pathsafe.ResolveUnderRoot("/root", seg); err == nil {
			return seg, true
		}
	}
	clean = fsutil.SanitizeExistingFilename(seg)
	return clean, clean != ""
}

// cleanCollectionPath cleans every segment of a bundle collection path and
// drops the ones that clean to nothing (an empty segment, "..", "..."), the
// same way fsutil.SanitizeRelativePath drops them. A path that is left
// empty means "no collection". It returns a new slice and never fails, so a
// hostile bundle cannot abort a restore.
func cleanCollectionPath(path []string) []string {
	if len(path) == 0 {
		return path
	}
	out := make([]string, 0, len(path))
	for _, seg := range path {
		if clean, ok := cleanCollectionSegment(seg); ok {
			out = append(out, clean)
		}
	}
	return out
}

// cleanBundlePaths returns a copy of bundle whose path-like fields are
// cleaned: every collection's Path, every item's CollectionPath (the
// reference to a collection by path, cleaned by the same function so they
// still line up) and every item's Folder (a relative "/"-separated
// download folder, cleaned like the enqueue path does). The caller's bundle
// is not modified.
func cleanBundlePaths(bundle LibraryBundle) LibraryBundle {
	if len(bundle.Collections) > 0 {
		cols := make([]CollectionEntry, len(bundle.Collections))
		for i, c := range bundle.Collections {
			c.Path = cleanCollectionPath(c.Path)
			cols[i] = c
		}
		bundle.Collections = cols
	}
	if len(bundle.LibraryItems) > 0 {
		items := make([]LibraryItemEntry, len(bundle.LibraryItems))
		for i, it := range bundle.LibraryItems {
			it.CollectionPath = cleanCollectionPath(it.CollectionPath)
			it.Folder = fsutil.SanitizeExistingRelativePath(it.Folder)
			items[i] = it
		}
		bundle.LibraryItems = items
	}
	return bundle
}

// PreviewCollectionEntry is one collection in a preview's flattened list,
// annotated with whether it already exists locally (matched by path) or
// would be newly created by an import.
type PreviewCollectionEntry struct {
	Path  []string `json:"path"`
	Name  string   `json:"name"`
	IsNew bool     `json:"isNew"`
	// MatchedByName is true when no collection has the bundle's folder name
	// but one collection's display name equals Name: the import will use that
	// collection (ExistingPath is its folder chain) instead of creating one.
	MatchedByName bool     `json:"matchedByName,omitempty"`
	ExistingPath  []string `json:"existingPath,omitempty"`
	// Unresolved is true when the collection can be neither matched nor
	// created (see LibraryBundlePreview.UnresolvedCollections).
	Unresolved bool `json:"unresolved,omitempty"`
}

// PreviewLibraryItem is one library item in a preview, carrying the same
// human-readable (name-based) fields LibraryItemEntry does plus whether it
// already matches an existing library row by URL.
type PreviewLibraryItem struct {
	Title            string   `json:"title"`
	OriginalURL      string   `json:"originalUrl"`
	CollectionPath   []string `json:"collectionPath,omitempty"`
	ArtistName       string   `json:"artistName,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	DownloadType     string   `json:"downloadType,omitempty"`
	Quality          string   `json:"quality,omitempty"`
	Year             *int     `json:"year,omitempty"`
	AlreadyInLibrary bool     `json:"alreadyInLibrary"`
	// IsGhost mirrors LibraryItemEntry.Status — true means this entry will be
	// recreated as a placeholder (no download queued), not filled in.
	IsGhost bool `json:"isGhost,omitempty"`
}

// LibraryBundlePreview is a read-only summary of what ApplyLibraryBundle
// would do with bundle, computed by PreviewLibraryBundle without writing
// anything — for the Backup page's "Preview" step, so a user can see what's
// inside an export before committing to importing it.
type LibraryBundlePreview struct {
	Collections    []PreviewCollectionEntry `json:"collections"`
	CollectionsNew int                      `json:"collectionsNew"`
	// CollectionsMatchedByName counts the collections an import would match by
	// display name; UnresolvedCollections lists the chains it could not place
	// and CollectionsNameKept the ones it would create under their folder name.
	CollectionsMatchedByName int                    `json:"collectionsMatchedByName"`
	CollectionsNameKept      []CollectionNameKept   `json:"collectionsNameKept"`
	UnresolvedCollections    []UnresolvedCollection `json:"unresolvedCollections"`
	Tags                     []string               `json:"tags"`
	TagsNew                  int                    `json:"tagsNew"`
	Artists                  []string               `json:"artists"`
	ArtistsNew               int                    `json:"artistsNew"`
	Items                    []PreviewLibraryItem   `json:"items"`
	AlreadyInLibrary         int                    `json:"alreadyInLibrary"`
}

// PreviewLibraryBundle computes LibraryBundlePreview via read-only List/
// FindDuplicates lookups — mirroring ApplyLibraryBundle's name/path matching
// logic exactly, but never creating or updating anything, so it's safe to
// run against an untrusted uploaded file before the user decides to import.
func PreviewLibraryBundle(
	ctx context.Context,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	bundle LibraryBundle,
) (LibraryBundlePreview, error) {
	var preview LibraryBundlePreview
	bundle = cleanBundlePaths(bundle) // match what Apply will actually create

	cols, err := collectionsRepo.List(ctx)
	if err != nil {
		return preview, err
	}
	// Same resolver as the import (in dry-run mode), so the preview cannot say
	// anything the import will not do.
	resolver := newChainResolver(ctx, nil, cols, bundle.Collections, nil)
	preview.Collections = make([]PreviewCollectionEntry, len(bundle.Collections))
	for i, c := range bundle.Collections {
		entry := PreviewCollectionEntry{Path: c.Path, Name: c.Name}
		if len(c.Path) > 0 {
			l := resolver.resolve(c.Path)
			switch l.kind {
			case levelCreated:
				entry.IsNew = true
				preview.CollectionsNew++
			case levelName:
				entry.MatchedByName = true
				entry.ExistingPath = l.existingPath
			case levelFailed:
				entry.Unresolved = true
			}
		}
		preview.Collections[i] = entry
	}
	// Items resolve after the entries, like the import, so chains that only
	// items reference are accounted for (and counted against an unresolved one).
	for _, item := range bundle.LibraryItems {
		resolver.lookup(item.CollectionPath, true)
	}
	preview.CollectionsMatchedByName = len(resolver.matched)
	preview.CollectionsNameKept = resolver.nameKeptReport()
	preview.UnresolvedCollections = resolver.unresolvedReport()

	tagRows, err := tagsRepo.List(ctx)
	if err != nil {
		return preview, err
	}
	existingTagNames := make(map[string]bool, len(tagRows))
	for _, t := range tagRows {
		existingTagNames[t.Name] = true
	}
	for _, t := range bundle.Tags {
		preview.Tags = append(preview.Tags, t.Name)
		if !existingTagNames[t.Name] {
			preview.TagsNew++
		}
	}

	artistRows, err := artistsRepo.List(ctx)
	if err != nil {
		return preview, err
	}
	existingArtistNames := make(map[string]bool, len(artistRows))
	for _, a := range artistRows {
		existingArtistNames[a.Name] = true
	}
	seenArtistNames := make(map[string]bool)
	addArtist := func(name string) {
		if name == "" || seenArtistNames[name] {
			return
		}
		seenArtistNames[name] = true
		preview.Artists = append(preview.Artists, name)
		if !existingArtistNames[name] {
			preview.ArtistsNew++
		}
	}
	for _, a := range bundle.Artists {
		addArtist(a.Name)
	}
	for _, item := range bundle.LibraryItems {
		addArtist(item.ArtistName)
	}
	for _, entry := range bundle.Collections {
		addArtist(entry.ArtistName)
	}

	queries := make([]repository.DuplicateQuery, len(bundle.LibraryItems))
	for i, item := range bundle.LibraryItems {
		queries[i] = repository.DuplicateQuery{URL: item.OriginalURL}
	}
	dupsByIndex, err := libraryRepo.FindDuplicates(ctx, queries)
	if err != nil {
		return preview, err
	}

	preview.Items = make([]PreviewLibraryItem, len(bundle.LibraryItems))
	for i, item := range bundle.LibraryItems {
		_, alreadyInLibrary := dupsByIndex[i]
		preview.Items[i] = PreviewLibraryItem{
			Title:            item.Title,
			OriginalURL:      item.OriginalURL,
			CollectionPath:   item.CollectionPath,
			ArtistName:       item.ArtistName,
			Tags:             item.Tags,
			DownloadType:     item.DownloadType,
			Quality:          item.Quality,
			Year:             item.Year,
			AlreadyInLibrary: alreadyInLibrary,
			// IsGhost means "will be a ghost regardless of import mode" — only
			// true when there's no URL to download from at all. A ghost that
			// does have a URL is downloadable, so it's not flagged here; it's
			// still recreated as a ghost when the caller picks ghostOnly mode
			// (handled purely on the frontend via the mode toggle).
			IsGhost: item.OriginalURL == "",
		}
		if alreadyInLibrary {
			preview.AlreadyInLibrary++
		}
	}

	return preview, nil
}

// ResolvedDownload is a library item resolved against the local database —
// collection/artist names turned into local IDs — ready to be handed to
// enqueueDownload by the caller (in package api, to avoid an import cycle:
// enqueueDownload/CreateDownloadRequest live in api, which imports this
// package, so this package can't import api back).
type ResolvedDownload struct {
	URL            string
	CollectionID   *int64
	Folder         string
	Filename       string
	DownloadType   string
	Quality        string
	AudioFormat    string
	ArtistID       *int64
	Year           *int
	SeasonNumber   *int
	SequenceNumber *int
	Tags           []string
}

type ApplyResult struct {
	// CollectionsEnsured counts the distinct collection chains the bundle
	// referenced that resolved to a collection, whether matched or created.
	CollectionsEnsured int `json:"collectionsEnsured"`
	// CollectionsCreated counts the collections this restore created.
	CollectionsCreated int `json:"collectionsCreated"`
	TagsCreated        int `json:"tagsCreated"`
	ArtistsCreated     int `json:"artistsCreated"`
	// GhostsCreated counts entries with Status "ghost" — created directly as
	// placeholder rows (see ApplyLibraryBundle), not included in the
	// returned []ResolvedDownload since there's nothing to download for them.
	GhostsCreated int `json:"ghostsCreated"`
	// CollectionsMatchedByName counts the collections matched by display name
	// because no collection had the bundle's folder name; MatchedByName lists
	// them.
	CollectionsMatchedByName int               `json:"collectionsMatchedByName"`
	MatchedByName            []CollectionMatch `json:"matchedByName"`
	// CollectionsNameKept lists the collections created under their folder name
	// because the bundle's display name was taken by a sibling.
	CollectionsNameKept []CollectionNameKept `json:"collectionsNameKept"`
	// UnresolvedCollections lists the chains that could be neither matched nor
	// created. Their items were still imported, uncategorized.
	UnresolvedCollections []UnresolvedCollection `json:"unresolvedCollections"`
}

// ApplyLibraryBundle merges bundle into the local database — matching
// collections by folder chain, then by display name (see chainResolver), and
// tags/artists by name, creating only what's missing, never deleting anything.
// Only a collection this restore creates takes its entry's settings; existing
// ones are never modified. Every step is best-effort in the sense that a
// conflict on one entry is reported (ApplyResult.UnresolvedCollections) rather
// than aborting the whole import — but
// the reconciliation as a whole runs inside one transaction, so a crash or
// cancellation partway through rolls back cleanly instead of leaving the
// bundle half-applied with no record of where it stopped.
//
// ghostOnly, when true, recreates every item as a ghost placeholder instead
// of enqueueing a download for entries that have a URL — for restoring onto
// a system where redownloading isn't wanted (yet).
func ApplyLibraryBundle(
	ctx context.Context,
	db *sql.DB,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	bundle LibraryBundle,
	ghostOnly bool,
) ([]ResolvedDownload, ApplyResult, error) {
	var result ApplyResult
	// Clean collection paths and folders first (never fails), so the entries
	// and the items that reference them are cleaned identically.
	bundle = cleanBundlePaths(bundle)

	// Lock order: repo mutexes first, DB connection second. The pool has one
	// connection, so opening the tx first and then waiting on a mutex that a
	// connection-hungry goroutine holds would deadlock the whole app. The
	// tx-scoped repo copies below skip re-locking (the mutex isn't
	// reentrant). Released only after commit/rollback — defers run LIFO, so
	// the rollback registered further down runs before this unlock.
	lk := repository.LockForRestore(tagsRepo, artistsRepo, collectionsRepo)
	defer lk.Unlock()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, result, fmt.Errorf("beginning import transaction: %w", err)
	}
	defer tx.Rollback()

	collectionsRepo = collectionsRepo.WithLockedTx(tx, lk)
	tagsRepo = tagsRepo.WithLockedTx(tx, lk)
	artistsRepo = artistsRepo.WithLockedTx(tx, lk)
	libraryRepo = libraryRepo.WithTx(tx)

	if len(bundle.Tags) > 0 {
		before, err := tagsRepo.List(ctx)
		if err != nil {
			return nil, result, err
		}
		existingTags := make(map[string]bool, len(before))
		for _, t := range before {
			existingTags[t.Name] = true
		}

		names := make([]string, len(bundle.Tags))
		for i, t := range bundle.Tags {
			names[i] = t.Name
		}
		// GetOrCreateByNames returns ids in the same (deduplicated) order as
		// names, so ids[i] corresponds to bundle.Tags[i] — used below to sync
		// each tag's IsPrivate flag.
		ids, err := tagsRepo.GetOrCreateByNames(ctx, names)
		if err != nil {
			return nil, result, err
		}
		for i, name := range names {
			if !existingTags[name] {
				result.TagsCreated++
			}
			_ = tagsRepo.Update(ctx, ids[i], bundle.Tags[i].Name, bundle.Tags[i].IsPrivate) // best-effort — a name clash just skips the sync
		}
	}

	artistRows, err := artistsRepo.List(ctx)
	if err != nil {
		return nil, result, err
	}
	artistIDs := make(map[string]int64, len(artistRows))
	for _, a := range artistRows {
		artistIDs[a.Name] = a.ID
	}
	// ensureArtist makes sure name exists. entry carries the backup's flag and
	// birthday (nil for artists only referenced by an item or collection).
	// Created artists get them as-is; existing ones only upgrade: the private
	// flag is never cleared and a birthday only fills a blank.
	ensureArtist := func(name string, entry *ArtistEntry) {
		if name == "" {
			return
		}
		var bd *string
		if entry != nil && entry.Birthday != "" {
			if validBirthday(entry.Birthday) {
				bd = &entry.Birthday
			} else {
				log.Printf("backup restore: skipping invalid birthday %q for artist %q", entry.Birthday, name)
			}
		}
		private := entry != nil && entry.IsPrivate

		if id, ok := artistIDs[name]; ok {
			if private || bd != nil {
				if err := artistsRepo.MergeFromBackup(ctx, id, private, bd); err != nil {
					log.Printf("backup restore: updating artist %q: %v", name, err)
				}
			}
			return
		}
		created, err := artistsRepo.CreateWithPrivacy(ctx, name, bd, private)
		if err != nil {
			return // best-effort — e.g. a race with a concurrent creator
		}
		artistIDs[created.Name] = created.ID
		result.ArtistsCreated++
	}
	for i := range bundle.Artists {
		ensureArtist(bundle.Artists[i].Name, &bundle.Artists[i])
	}
	for _, item := range bundle.LibraryItems {
		ensureArtist(item.ArtistName, nil)
	}
	for _, entry := range bundle.Collections {
		ensureArtist(entry.ArtistName, nil)
	}

	existingCols, err := collectionsRepo.List(ctx)
	if err != nil {
		return nil, result, err
	}
	resolver := newChainResolver(ctx, collectionsRepo, existingCols, bundle.Collections, artistIDs)
	collectionIDs := make(map[string]int64) // key: chain; counts each resolved chain once
	ensureCollection := func(path []string, forItem bool) *int64 {
		key := chainKey(path)
		idPtr := resolver.lookup(path, forItem)
		if idPtr == nil {
			return nil
		}
		if _, seen := collectionIDs[key]; !seen {
			collectionIDs[key] = *idPtr
			result.CollectionsEnsured++
		}
		return idPtr
	}
	for i := range bundle.Collections {
		ensureCollection(bundle.Collections[i].Path, false)
	}

	// Tag assignment for freshly created ghosts happens after commit, below
	// — TagsRepo.SetForLibraryItem always opens its own subordinate
	// transaction against the real *sql.DB (SQLite doesn't support nesting
	// one inside another), so it can't run against this function's still-open tx.
	type ghostTagAssignment struct {
		id     int64
		tagIDs []int64
	}
	var ghostTagAssignments []ghostTagAssignment

	resolved := make([]ResolvedDownload, 0, len(bundle.LibraryItems))
	for _, item := range bundle.LibraryItems {
		// A ghost with a saved URL is downloadable, so it's only kept as a
		// ghost when ghostOnly is set — same as any other item. Only a
		// missing URL forces the ghost path unconditionally, since there's
		// nothing to queue a download from.
		if item.OriginalURL == "" || ghostOnly {
			mediaType := item.MediaType
			if mediaType == "" {
				mediaType = "video" // defensive default — every ghost this app itself creates always sets one
			}
			ghost := models.LibraryItem{
				Title:          item.Title,
				Filename:       "",
				Path:           "",
				Status:         "ghost",
				MediaType:      &mediaType,
				CollectionID:   ensureCollection(item.CollectionPath, true),
				ReleaseYear:    item.Year,
				SequenceNumber: item.SequenceNumber,
				SeasonNumber:   item.SeasonNumber,
			}
			if item.OriginalURL != "" {
				url := item.OriginalURL
				ghost.OriginalURL = &url
			}
			if item.ArtistName != "" {
				if id, ok := artistIDs[item.ArtistName]; ok {
					ghost.ArtistID = &id
				}
			}
			id, err := libraryRepo.Create(ctx, &ghost)
			if err != nil {
				log.Printf("backup import: creating ghost item %q: %v", item.Title, err)
				continue
			}
			result.GhostsCreated++
			if len(item.Tags) > 0 {
				tagIDs, err := tagsRepo.GetOrCreateByNames(ctx, item.Tags)
				if err != nil {
					log.Printf("backup import: resolving tags for ghost item %q: %v", item.Title, err)
				} else if len(tagIDs) > 0 {
					ghostTagAssignments = append(ghostTagAssignments, ghostTagAssignment{id: id, tagIDs: tagIDs})
				}
			}
			continue
		}
		r := ResolvedDownload{
			URL:            item.OriginalURL,
			Folder:         item.Folder,
			Filename:       item.Filename,
			DownloadType:   item.DownloadType,
			Quality:        item.Quality,
			AudioFormat:    item.AudioFormat,
			Year:           item.Year,
			SeasonNumber:   item.SeasonNumber,
			SequenceNumber: item.SequenceNumber,
			Tags:           item.Tags,
		}
		// The original Download row was already gone at export time (so
		// downloadType/quality/audioFormat were omitted, see BuildLibraryBundle) —
		// infer from the item's own filename rather than leaving it to the
		// caller's app-wide default, which can conflict with an
		// already-audio-typed filename (redownloading "Song.mp3" as a video
		// makes yt-dlp fail outright, since the format it fetches can't be
		// written into that container).
		if r.DownloadType == "" {
			if inferredType, inferredFormat := fsutil.AudioFormatFromExtension(item.Filename); inferredType != "" {
				r.DownloadType = inferredType
				if r.AudioFormat == "" {
					r.AudioFormat = inferredFormat
				}
			}
		}
		r.CollectionID = ensureCollection(item.CollectionPath, true)
		if item.ArtistName != "" {
			if id, ok := artistIDs[item.ArtistName]; ok {
				r.ArtistID = &id
			}
		}
		resolved = append(resolved, r)
	}

	result.CollectionsCreated = 0
	for _, l := range resolver.levels {
		if l.kind == levelCreated {
			result.CollectionsCreated++
		}
	}
	result.CollectionsMatchedByName = len(resolver.matched)
	result.MatchedByName = resolver.matchedReport()
	result.CollectionsNameKept = resolver.nameKeptReport()
	result.UnresolvedCollections = resolver.unresolvedReport()
	for _, u := range result.UnresolvedCollections {
		log.Printf("backup import: collection %q was not restored: %s (%d items imported uncategorized)", strings.Join(u.Path, "/"), u.Reason, u.Items)
	}

	if err := tx.Commit(); err != nil {
		return nil, result, fmt.Errorf("committing import transaction: %w", err)
	}

	// Only reachable after the ghost rows themselves are durably committed —
	// SetForLibraryItem needs a real *sql.DB (see ghostTagAssignment's doc
	// comment above), so this couldn't run any earlier. Best-effort: a
	// failure here leaves the ghost item itself intact, just without tags.
	for _, g := range ghostTagAssignments {
		if err := tagsRepo.SetForLibraryItem(ctx, g.id, g.tagIDs); err != nil {
			log.Printf("backup import: assigning tags to ghost item %d: %v", g.id, err)
		}
	}

	return resolved, result, nil
}
