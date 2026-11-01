package api

import (
	"context"

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
	mediaRoot       string
}

func NewItemResponder(settingsRepo *repository.SettingsRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, galleryRepo *repository.ThumbnailGalleryRepo, mediaRoot string) *ItemResponder {
	return &ItemResponder{settingsRepo, collectionsRepo, tagsRepo, artistsRepo, galleryRepo, mediaRoot}
}

// Responses batch-loads tags, gallery counts and the privacy resolver once
// and returns one response per item, in order.
func (r *ItemResponder) Responses(ctx context.Context, items []models.LibraryItem) ([]LibraryItemResponse, error) {
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
	privacy, err := LoadItemPrivacy(ctx, r.settingsRepo, r.collectionsRepo, r.tagsRepo, r.artistsRepo)
	if err != nil {
		return nil, err
	}
	out := make([]LibraryItemResponse, 0, len(items))
	for _, item := range items {
		tags := tagsByID[item.ID]
		out = append(out, toLibraryItemResponse(item, privacy.Blurred(item.CollectionID, item.ArtistID, tags), tags, galleryCountByID[item.ID], r.mediaRoot))
	}
	return out, nil
}

// Response is Responses for a single item. Tags are read from the DB, so the
// response reflects what is actually stored.
func (r *ItemResponder) Response(ctx context.Context, item models.LibraryItem) (LibraryItemResponse, error) {
	out, err := r.Responses(ctx, []models.LibraryItem{item})
	if err != nil {
		return LibraryItemResponse{}, err
	}
	return out[0], nil
}
