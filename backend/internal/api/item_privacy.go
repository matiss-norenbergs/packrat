package api

import (
	"context"
	"sync"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// ItemPrivacy decides whether a library item is blurred. It is the single
// place the rule exists: the privacy master switch is on AND (the item's
// collection is effectively private — itself or any ancestor — OR the item's
// own artist is private OR the item carries a private tag). Every response that exposes `blurred` goes through
// Blurred; don't re-derive the rule in a handler.
//
// Load it once per request (LoadItemPrivacy) and reuse it for every item in
// that response.
type ItemPrivacy struct {
	enabled        bool
	collectionPriv map[int64]bool // effectivePrivacyMap: collection id -> self or ancestor private
	privateTags    map[string]bool
	privateArtists map[int64]bool // artist id -> is_private
}

func newItemPrivacy(enabled bool, cols []models.Collection, privateTags map[string]bool, privateArtists map[int64]bool) *ItemPrivacy {
	return &ItemPrivacy{
		enabled:        enabled,
		collectionPriv: effectivePrivacyMap(cols),
		privateTags:    privateTags,
		privateArtists: privateArtists,
	}
}

// LoadItemPrivacy reads the master switch, the collections tree and the
// private tag names and private artist ids. When the switch is off it skips the other queries —
// Blurred is false regardless of them.
func LoadItemPrivacy(ctx context.Context, settingsRepo *repository.SettingsRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo) (*ItemPrivacy, error) {
	enabled, err := PrivacyEnabled(ctx, settingsRepo)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return newItemPrivacy(false, nil, nil, nil), nil
	}
	cols, err := collectionsRepo.List(ctx)
	if err != nil {
		return nil, err
	}
	privateTags, err := tagsRepo.PrivateTagNames(ctx)
	if err != nil {
		return nil, err
	}
	privateArtists, err := artistsRepo.PrivateArtistIDs(ctx)
	if err != nil {
		return nil, err
	}
	return newItemPrivacy(true, cols, privateTags, privateArtists), nil
}

// Blurred reports whether an item in collectionID (nil = no collection) by
// artistID (nil = no artist) carrying tagNames should be blurred. Always false when privacy is off.
func (p *ItemPrivacy) Blurred(collectionID *int64, artistID *int64, tagNames []string) bool {
	if !p.enabled {
		return false
	}
	if collectionID != nil && p.collectionPriv[*collectionID] {
		return true
	}
	if artistID != nil && p.privateArtists[*artistID] {
		return true
	}
	for _, t := range tagNames {
		if p.privateTags[t] {
			return true
		}
	}
	return false
}

// ItemResponder builds LibraryItemResponse values — tags, gallery counts and
// the blurred flag included — for every handler that returns library items,
// so the loading and the privacy rule live in one place.
type ItemResponder struct {
	settingsRepo    *repository.SettingsRepo
	collectionsRepo *repository.CollectionsRepo
	tagsRepo        *repository.TagsRepo
	artistsRepo     *repository.ArtistsRepo
	galleryRepo     *repository.ThumbnailGalleryRepo
	downloadsRepo   *repository.DownloadsRepo
	mediaRoot       string
	// nfoExists reports whether an item's .nfo sidecar is on disk; a field so
	// tests can count and fake the stats.
	nfoExists func(mediaRoot, relPath string) bool
}

func NewItemResponder(settingsRepo *repository.SettingsRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, galleryRepo *repository.ThumbnailGalleryRepo, downloadsRepo *repository.DownloadsRepo, mediaRoot string) *ItemResponder {
	return &ItemResponder{settingsRepo, collectionsRepo, tagsRepo, artistsRepo, galleryRepo, downloadsRepo, mediaRoot, nfoSidecarExists}
}

// nfoStatWorkers bounds how many .nfo existence checks run at once in a list
// response, so a network share's per-stat latency overlaps instead of adding up.
const nfoStatWorkers = 8

// Responses batch-loads tags, gallery counts and the privacy resolver once
// and returns one response per item, in order. It is the LIST form: to keep
// the response from costing one disk stat per library item, `nfoExists` is only
// looked up (on a bounded worker pool) for items whose `generateNfo` is on; for
// the others it is false without having been checked. Response (single item)
// always checks.
func (r *ItemResponder) Responses(ctx context.Context, items []models.LibraryItem) ([]LibraryItemResponse, error) {
	return r.responses(ctx, items, false)
}

// responses builds the responses; statAll makes every item's .nfo existence
// real (single-item form), otherwise only generateNfo items' (list form).
func (r *ItemResponder) responses(ctx context.Context, items []models.LibraryItem, statAll bool) ([]LibraryItemResponse, error) {
	ids := make([]int64, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	tagsByID, err := r.tagsRepo.TagsByLibraryIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	galleryCountByID, err := r.galleryRepo.CountsByLibraryItemIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	activeByID, err := r.downloadsRepo.ActiveDownloadIDsByLibraryItem(ctx, ids)
	if err != nil {
		return nil, err
	}
	privacy, err := LoadItemPrivacy(ctx, r.settingsRepo, r.collectionsRepo, r.tagsRepo, r.artistsRepo)
	if err != nil {
		return nil, err
	}
	nfoExists := r.nfoExistsFor(ctx, items, statAll)
	out := make([]LibraryItemResponse, 0, len(items))
	for i, item := range items {
		tags := tagsByID[item.ID]
		var activeDownloadID *int64
		if dlID, ok := activeByID[item.ID]; ok {
			activeDownloadID = &dlID
		}
		out = append(out, toLibraryItemResponse(item, privacy.Blurred(item.CollectionID, item.ArtistID, tags), tags, galleryCountByID[item.ID], activeDownloadID, nfoExists[i]))
	}
	return out, nil
}

// nfoExistsFor returns, per item and in item order, whether its .nfo sidecar
// exists. Items it is not asked to check (generateNfo off in list form, or no
// file) are false without touching the disk; the rest are stat'ed by at most
// nfoStatWorkers goroutines.
func (r *ItemResponder) nfoExistsFor(ctx context.Context, items []models.LibraryItem, statAll bool) []bool {
	out := make([]bool, len(items))
	var todo []int
	for i, item := range items {
		if item.Path != "" && (statAll || item.GenerateNFO) {
			todo = append(todo, i)
		}
	}
	check := r.nfoExists
	if check == nil {
		check = nfoSidecarExists
	}
	if len(todo) <= 1 {
		for _, i := range todo {
			out[i] = check(r.mediaRoot, items[i].Path)
		}
		return out
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	workers := nfoStatWorkers
	if workers > len(todo) {
		workers = len(todo)
	}
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = check(r.mediaRoot, items[i].Path) // each index is written by one worker only
			}
		}()
	}
	for _, i := range todo {
		if ctx.Err() != nil {
			break // client gone: leave the rest false rather than keep stat'ing
		}
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return out
}

// Response is Responses for a single item. Tags are read from the DB, so the
// response reflects what is actually stored.
func (r *ItemResponder) Response(ctx context.Context, item models.LibraryItem) (LibraryItemResponse, error) {
	out, err := r.responses(ctx, []models.LibraryItem{item}, true)
	if err != nil {
		return LibraryItemResponse{}, err
	}
	return out[0], nil
}

// BlurredItems applies the same privacy rule as Responses to items that are not returned as
// library items (duplicate warnings), loading tags and the resolver once. The map is keyed by
// item id and is all false when the privacy switch is off.
func (r *ItemResponder) BlurredItems(ctx context.Context, items []models.LibraryItem) (map[int64]bool, error) {
	out := make(map[int64]bool, len(items))
	if len(items) == 0 {
		return out, nil
	}
	privacy, err := LoadItemPrivacy(ctx, r.settingsRepo, r.collectionsRepo, r.tagsRepo, r.artistsRepo)
	if err != nil {
		return nil, err
	}
	if !privacy.enabled {
		return out, nil
	}
	ids := make([]int64, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	tagsByID, err := r.tagsRepo.TagsByLibraryIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		out[item.ID] = privacy.Blurred(item.CollectionID, item.ArtistID, tagsByID[item.ID])
	}
	return out, nil
}

// duplicateInfo builds the duplicate warning for dup, flagged blurred by the item privacy rule.
func (r *ItemResponder) duplicateInfo(ctx context.Context, dup *models.LibraryItem) (*DuplicateInfo, error) {
	blurred, err := r.BlurredItems(ctx, []models.LibraryItem{*dup})
	if err != nil {
		return nil, err
	}
	return &DuplicateInfo{
		LibraryItemID: dup.ID,
		Title:         dup.Title,
		Thumbnail:     dup.Thumbnail,
		DownloadedAt:  dup.DownloadedAt.Format(time.RFC3339),
		Blurred:       blurred[dup.ID],
	}, nil
}
