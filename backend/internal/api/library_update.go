package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/metaembed"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// libraryUpdater holds what the per-item edit core needs. The core was the body
// of the former single-item edit handler; POST /api/library/bulk-update
// calls it once per item (a single edit is a one-element list).
type libraryUpdater struct {
	repo          *repository.LibraryRepo
	mediaRoot     string
	mgr           *queue.DownloadManager
	tagsRepo      *repository.TagsRepo
	artistsRepo   *repository.ArtistsRepo
	downloadsRepo *repository.DownloadsRepo
}

// reverseRenameSteps returns steps with every Old/New swapped (media file still
// first, as RenameAll requires), to undo a completed RenameAll.
func reverseRenameSteps(steps []fsutil.RenameStep) []fsutil.RenameStep {
	out := make([]fsutil.RenameStep, len(steps))
	for i, st := range steps {
		out[i] = fsutil.RenameStep{Old: st.New, New: st.Old, Label: st.Label}
	}
	return out
}

// renameOpError maps a fsutil.RenameAll failure to 409 for a destination
// collision and 500 otherwise (the opError twin of writeRenameError).
func renameOpError(err error) *opError {
	if errors.Is(err, fsutil.ErrDestinationExists) {
		return newOpError(http.StatusConflict, err.Error())
	}
	return internalOpError(err)
}

// update applies one item's changes. It updates the display title (DB only)
// and/or the actual filename (renames the media file, its thumbnail and its .nfo
// sidecar on disk, then updates the DB — see fsutil.RenameAll for the
// best-effort atomicity) and/or the display-only metadata fields (uploader,
// description, duration, resolution, artist, year, ...). Fields omitted from the
// request are left untouched — the current value is merged in before writing, so
// a form that only sends the fields it changed can never blank out the others.
// If title/artist/year/season/sequence changed, the file's own container
// metadata is best-effort updated to match (see metaembed) through the
// coalescing scheduler in the background; a failure there never fails the
// request.
//
// Guards, in order: an item with an active download is a 409 (the old
// notDownloading route guard); a filename change needs the item lock and a busy
// item is a 409 with itemBusyMessage. Then three phases: (1) validate everything
// that can fail without side effects (filename, rename destinations, tag ids,
// artist) so a request that cannot be applied changes nothing; (2) rename the
// files and record the new path at once (rolled back if recording fails); (3)
// the remaining writes. The phase 3 writes are independent statements, as
// before — the order and the early validation only remove the partial
// application the old title-first order caused; the edit as a whole is not one
// transaction. A nil return means success.
func (u *libraryUpdater) update(ctx context.Context, id int64, req UpdateLibraryItemRequest) *opError {
	if _, active, err := activeDownloadFor(ctx, u.downloadsRepo, id); err != nil {
		return internalOpError(err)
	} else if active {
		return newOpError(http.StatusConflict, "a download is already in progress for this item")
	}

	// Renaming the file is a file operation: refuse before anything in the
	// request is applied if a remux (or another file operation) holds the
	// item. Taken before the Get so the row read below is current.
	if req.Filename != nil {
		locks := u.mgr.ItemLocks()
		if !locks.TryLock(id) {
			return newOpError(http.StatusConflict, itemBusyMessage)
		}
		defer locks.Unlock(id)
	}

	item, err := u.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return newOpError(http.StatusNotFound, "library item not found")
		}
		return internalOpError(err)
	}

	mediaRoot := u.mediaRoot
	mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

	// Phase 1 — validate everything that can fail, with no side effects, so a
	// request that cannot be applied changes nothing (it used to save the
	// title first and only then report the rename failure, leaving the other
	// fields unapplied).
	var (
		renameSteps  []fsutil.RenameStep
		newBase      string
		mediaExt     string
		newMediaAbs  string
		newThumbAbs  string
		newThumbRel  *string
		tagIDs       []int64
		remuxSubmit  bool
		remuxArtist  *string
		newArtistRef = req.ArtistID != nil && *req.ArtistID != 0
	)
	if req.Filename != nil {
		if item.Path == "" {
			return newOpError(http.StatusBadRequest, "item has no media file to rename")
		}
		newBase = fsutil.SanitizeFilename(*req.Filename)
		if newBase == "" {
			return newOpError(http.StatusBadRequest, "invalid filename")
		}

		mediaExt = filepath.Ext(item.Filename)
		oldMediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		dir := filepath.Dir(oldMediaAbs)
		newMediaAbs = filepath.Join(dir, newBase+mediaExt)

		var oldThumbAbs string
		if item.Thumbnail != nil {
			thumbExt := filepath.Ext(*item.Thumbnail)
			oldThumbAbs = filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			newThumbAbs = filepath.Join(dir, newBase+thumbExt)
			s := toRelSlash(mediaRoot, newThumbAbs)
			newThumbRel = &s
		}
		renameSteps = libraryRenameSteps(oldMediaAbs, newMediaAbs, oldThumbAbs, newThumbAbs)
		// Destinations only (media, thumbnail, .nfo); nothing is renamed yet.
		if err := fsutil.CheckRenameDestinations(renameSteps); err != nil {
			return renameOpError(err)
		}
	}

	// Database lookups the later writes depend on.
	if req.Tags != nil {
		tagIDs, err = u.tagsRepo.GetOrCreateByNames(ctx, *req.Tags)
		if err != nil {
			return internalOpError(err)
		}
	}
	remuxSubmit = (req.Title != nil || req.ArtistID != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil) && item.Path != ""
	artistID := item.ArtistID
	if req.ArtistID != nil {
		if *req.ArtistID == 0 {
			artistID = nil
		} else {
			artistID = req.ArtistID
		}
	}
	if artistID != nil && (remuxSubmit || newArtistRef) {
		a, err := u.artistsRepo.Get(ctx, *artistID)
		switch {
		case err == nil:
			remuxArtist = &a.Name
		case errors.Is(err, repository.ErrNotFound) && newArtistRef:
			return newOpError(http.StatusBadRequest, "artist not found")
		case errors.Is(err, repository.ErrNotFound):
			// The item's own stored artist vanished: embed without one, as before.
		default:
			return internalOpError(err)
		}
	}

	// Phase 2 — the rename is the only fallible disk step, so it runs first
	// and its result is recorded straight away; if recording fails the files
	// go back, so the files and the row never disagree.
	if req.Filename != nil {
		if err := fsutil.RenameAll(renameSteps); err != nil {
			return renameOpError(err)
		}
		if err := u.repo.UpdateFilename(ctx, id, newBase+mediaExt, toRelSlash(mediaRoot, newMediaAbs), newThumbRel); err != nil {
			if rbErr := fsutil.RenameAll(reverseRenameSteps(renameSteps)); rbErr != nil {
				log.Printf("library: rolling back rename of item %d failed: %v", id, rbErr)
				return internalOpError(fmt.Errorf("%w (rolling the rename back also failed: %v)", err, rbErr))
			}
			return internalOpError(err)
		}
		mediaAbs = newMediaAbs
	}

	// Phase 3 — the remaining writes, in the order they always had. They are
	// independent statements (not one transaction), as before: this ordering
	// only removes the partial application caused by validating late, it does
	// not make the whole edit atomic — a database failure here, after the
	// rename, can still leave the earlier writes of this request applied.
	if req.Title != nil {
		if err := u.repo.UpdateTitle(ctx, id, *req.Title); err != nil {
			return internalOpError(err)
		}
	}

	if req.Uploader != nil || req.Description != nil || req.Duration != nil || req.Resolution != nil || req.ArtistID != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil {
		uploader, description, duration, resolution := req.Uploader, req.Description, req.Duration, req.Resolution
		if uploader == nil {
			uploader = item.Uploader
		}
		if description == nil {
			description = item.Description
		}
		if duration == nil {
			duration = item.Duration
		}
		if resolution == nil {
			resolution = item.Resolution
		}
		year := clearableInt(req.Year, item.ReleaseYear)
		sequenceNumber := clearableInt(req.SequenceNumber, item.SequenceNumber)
		seasonNumber := clearableInt(req.SeasonNumber, item.SeasonNumber)
		// title=nil relies on UpdateMetadata's COALESCE(?, title) so this
		// call never touches title — that's handled by UpdateTitle above.
		if err := u.repo.UpdateMetadata(ctx, id, nil, uploader, duration, resolution, description, artistID, year, sequenceNumber, seasonNumber); err != nil {
			return internalOpError(err)
		}
	}

	if remuxSubmit {
		title := item.Title
		if req.Title != nil {
			title = *req.Title
		}
		year := clearableInt(req.Year, item.ReleaseYear)
		sequenceNumber := clearableInt(req.SequenceNumber, item.SequenceNumber)
		seasonNumber := clearableInt(req.SeasonNumber, item.SeasonNumber)
		// Backgrounded and never blocks the response. The scheduler runs it
		// under the item's lock, coalesces rapid saves of one item into at
		// most one running plus one pending (latest values win) and bounds
		// how many remuxes run at once across items (a bulk edit submits one
		// per row).
		u.mgr.Embedder().Submit(id, mediaAbs, metaembed.Request{Title: title, Artist: remuxArtist, Year: year, SequenceNumber: sequenceNumber, SeasonNumber: seasonNumber})
	}

	if req.OriginalURL != nil {
		trimmed := strings.TrimSpace(*req.OriginalURL)
		var urlPtr *string
		if trimmed != "" {
			urlPtr = &trimmed
		}
		if err := u.repo.UpdateOriginalURL(ctx, id, urlPtr); err != nil {
			return internalOpError(err)
		}
	}

	if req.Tags != nil {
		if err := u.tagsRepo.SetForLibraryItem(ctx, id, tagIDs); err != nil {
			return internalOpError(err)
		}
	}

	if req.GenerateNFO != nil {
		if err := u.repo.UpdateGenerateNFO(ctx, id, *req.GenerateNFO); err != nil {
			return internalOpError(err)
		}
	}

	// Keep an opted-in item's .nfo sidecar in sync whenever something it
	// reflects changes — including the toggle itself just being turned on,
	// so the file appears immediately rather than waiting for the next
	// unrelated edit. Failure here doesn't fail the request: the metadata
	// save itself already succeeded.
	nfoRelevant := req.Title != nil || req.Description != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil || req.Tags != nil ||
		(req.GenerateNFO != nil && *req.GenerateNFO)
	if nfoRelevant && item.Path != "" {
		if updated, err := u.repo.Get(ctx, id); err == nil && updated.GenerateNFO {
			if err := writeNFO(ctx, mediaRoot, u.tagsRepo, updated); err != nil {
				log.Printf("library: writing nfo for %d failed: %v", id, err)
			}
		}
	}
	return nil
}

// BulkUpdateLibraryItems is POST /api/library/bulk-update: it applies each
// item's changes through libraryUpdater.update, sequentially and independently
// (renames, remux scheduling and NFO writes cannot be rolled back by a
// transaction), and answers 200 with one result per item in request order.
// Duplicate ids are a 400: the two changes would be ambiguous.
func BulkUpdateLibraryItems(repo *repository.LibraryRepo, mediaRoot string, mgr *queue.DownloadManager, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, downloadsRepo *repository.DownloadsRepo) gin.HandlerFunc {
	u := &libraryUpdater{repo: repo, mediaRoot: mediaRoot, mgr: mgr, tagsRepo: tagsRepo, artistsRepo: artistsRepo, downloadsRepo: downloadsRepo}
	return func(c *gin.Context) {
		var req BulkUpdateLibraryItemsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.Items)) {
			return
		}
		seen := make(map[int64]struct{}, len(req.Items))
		for _, it := range req.Items {
			if _, dup := seen[it.ID]; dup {
				c.JSON(http.StatusBadRequest, gin.H{"error": "duplicate item id in request"})
				return
			}
			seen[it.ID] = struct{}{}
		}

		// Detached from the request on purpose: every item may rename files and
		// schedule a remux, which cannot be undone, so a client that goes away
		// (closed tab) must not leave half a batch silently unreported. The
		// loop finishes on its own context, bounded by bulkBatchTimeout.
		ctx, cancel := detachedBulkContext(c)
		defer cancel()

		resp := newBulkResults[int64](len(req.Items))
		for _, it := range req.Items {
			if e := u.update(ctx, it.ID, it.Changes); e != nil {
				resp.add(failedResult(it.ID, e))
				continue
			}
			resp.add(BulkItemResult[int64]{ID: it.ID, OK: true})
		}
		c.JSON(http.StatusOK, resp)
	}
}
