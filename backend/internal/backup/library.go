package backup

import (
	"context"
	"path/filepath"
	"strings"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type CollectionEntry struct {
	Path                []string `json:"path"` // root-path segments, root->leaf
	Name                string   `json:"name"`
	DefaultQuality      string   `json:"defaultQuality"`
	DefaultDownloadType string   `json:"defaultDownloadType"`
	IsPrivate           bool     `json:"isPrivate"`
	JellyfinLibrary     *string  `json:"jellyfinLibrary,omitempty"`
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
}

type LibraryBundle struct {
	Collections  []CollectionEntry  `json:"collections"`
	Tags         []string           `json:"tags"`
	Artists      []string           `json:"artists"`
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
// item that has a saved originalUrl — everything needed to reconstruct the
// library elsewhere by re-queueing downloads, without shipping any actual
// media file bytes.
func BuildLibraryBundle(
	ctx context.Context,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	downloadsRepo *repository.DownloadsRepo,
) (LibraryBundle, error) {
	var bundle LibraryBundle

	cols, err := collectionsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	paths := collectionPaths(cols)
	for _, c := range cols {
		bundle.Collections = append(bundle.Collections, CollectionEntry{
			Path:                paths[c.ID],
			Name:                c.Name,
			DefaultQuality:      c.DefaultQuality,
			DefaultDownloadType: c.DefaultDownloadType,
			IsPrivate:           c.IsPrivate,
			JellyfinLibrary:     c.JellyfinLibrary,
		})
	}

	tagRows, err := tagsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	for _, t := range tagRows {
		bundle.Tags = append(bundle.Tags, t.Name)
	}

	artistRows, err := artistsRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	for _, a := range artistRows {
		bundle.Artists = append(bundle.Artists, a.Name)
	}

	items, err := libraryRepo.List(ctx)
	if err != nil {
		return bundle, err
	}
	var filtered []models.LibraryItem
	var ids []int64
	for _, it := range items {
		if it.OriginalURL != nil {
			filtered = append(filtered, it)
			ids = append(ids, it.ID)
		}
	}
	tagsByItem, err := tagsRepo.TagsByLibraryIDs(ctx, ids)
	if err != nil {
		return bundle, err
	}

	for _, it := range filtered {
		entry := LibraryItemEntry{
			Title:          it.Title,
			OriginalURL:    *it.OriginalURL,
			Folder:         it.Folder,
			Filename:       it.Filename,
			Year:           it.ReleaseYear,
			SequenceNumber: it.SequenceNumber,
			SeasonNumber:   it.SeasonNumber,
			Tags:           tagsByItem[it.ID],
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
			if dl, err := downloadsRepo.Get(ctx, *it.DownloadID); err == nil {
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
	CollectionsEnsured int `json:"collectionsEnsured"`
	TagsCreated        int `json:"tagsCreated"`
	ArtistsCreated     int `json:"artistsCreated"`
}

// audioFormatFromExtension infers a download type/audio format from a
// library item's own filename, for the case where the export couldn't carry
// that information (its originating Download row was already gone at export
// time — see BuildLibraryBundle). Only recognizes the formats yt-dlp can
// actually produce via --audio-format (matching CreateDownloadRequest's
// accepted values) — anything else returns "" so the caller falls back to
// its own video default, same as before this existed.
func audioFormatFromExtension(filename string) (downloadType, audioFormat string) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".mp3", ".flac", ".m4a", ".aac", ".wav":
		return "audio", strings.TrimPrefix(ext, ".")
	default:
		return "", ""
	}
}

// ApplyLibraryBundle merges bundle into the local database — matching
// collections by path and tags/artists by name, creating only what's
// missing, never deleting anything. Every step is best-effort: a conflict
// on one entry (e.g. a collection rename colliding with an existing
// sibling) is skipped rather than aborting the whole import.
func ApplyLibraryBundle(
	ctx context.Context,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	bundle LibraryBundle,
) ([]ResolvedDownload, ApplyResult, error) {
	var result ApplyResult

	if len(bundle.Tags) > 0 {
		before, err := tagsRepo.List(ctx)
		if err != nil {
			return nil, result, err
		}
		existingTags := make(map[string]bool, len(before))
		for _, t := range before {
			existingTags[t.Name] = true
		}
		if _, err := tagsRepo.GetOrCreateByNames(ctx, bundle.Tags); err != nil {
			return nil, result, err
		}
		for _, name := range bundle.Tags {
			if !existingTags[name] {
				result.TagsCreated++
			}
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
	ensureArtist := func(name string) {
		if name == "" {
			return
		}
		if _, ok := artistIDs[name]; ok {
			return
		}
		created, err := artistsRepo.Create(ctx, name)
		if err != nil {
			return // best-effort — e.g. a race with a concurrent creator
		}
		artistIDs[created.Name] = created.ID
		result.ArtistsCreated++
	}
	for _, name := range bundle.Artists {
		ensureArtist(name)
	}
	for _, item := range bundle.LibraryItems {
		ensureArtist(item.ArtistName)
	}

	collectionIDs := make(map[string]int64) // key: path segments joined by "/"
	ensureCollection := func(path []string, entry *CollectionEntry) *int64 {
		if len(path) == 0 {
			return nil
		}
		key := strings.Join(path, "/")
		if id, ok := collectionIDs[key]; ok {
			return &id
		}
		idPtr, err := collectionsRepo.EnsureChain(ctx, path)
		if err != nil || idPtr == nil {
			return nil
		}
		id := *idPtr
		collectionIDs[key] = id
		result.CollectionsEnsured++

		if entry != nil {
			if existing, err := collectionsRepo.Get(ctx, id); err == nil {
				updated := *existing
				updated.Name = entry.Name
				updated.DefaultQuality = entry.DefaultQuality
				updated.DefaultDownloadType = entry.DefaultDownloadType
				updated.IsPrivate = entry.IsPrivate
				updated.JellyfinLibrary = entry.JellyfinLibrary
				_ = collectionsRepo.Update(ctx, id, &updated) // best-effort — a name clash just skips the rename
			}
		}
		return &id
	}
	for i := range bundle.Collections {
		ensureCollection(bundle.Collections[i].Path, &bundle.Collections[i])
	}

	resolved := make([]ResolvedDownload, 0, len(bundle.LibraryItems))
	for _, item := range bundle.LibraryItems {
		if item.OriginalURL == "" {
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
			if inferredType, inferredFormat := audioFormatFromExtension(item.Filename); inferredType != "" {
				r.DownloadType = inferredType
				if r.AudioFormat == "" {
					r.AudioFormat = inferredFormat
				}
			}
		}
		r.CollectionID = ensureCollection(item.CollectionPath, nil)
		if item.ArtistName != "" {
			if id, ok := artistIDs[item.ArtistName]; ok {
				r.ArtistID = &id
			}
		}
		resolved = append(resolved, r)
	}

	return resolved, result, nil
}
