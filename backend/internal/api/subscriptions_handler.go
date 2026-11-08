package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/subscriptions"
)

// CreateSubscription saves a channel/playlist URL and immediately baselines
// it (subscriptions.CreateBaselined) — the subscription row, every entry
// currently found (recorded as already-seen, without creating any ghost
// items or downloads) and last_checked_at are written in one transaction,
// since "subscribing" means "tell me about new uploads from now on," not
// "queue up the entire back catalog." Either all of it persists or none.
func CreateSubscription(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		var req CreateSubscriptionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !isHTTPURL(req.URL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url must be an http or https URL"})
			return
		}

		interval, err := resolveCreateInterval(req.CheckIntervalHours)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		meta, err := deps.YtDlp.FetchMetadata(ctx, req.URL)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "couldn't fetch this URL: " + err.Error()})
			return
		}

		title := meta.Title
		if title == "" {
			title = req.URL
		}

		sub := models.Subscription{
			URL:                req.URL,
			Title:              title,
			MediaType:          req.MediaType,
			CollectionID:       req.CollectionID,
			Tags:               req.Tags,
			AutoDownload:       req.AutoDownload,
			GenerateNFO:        req.GenerateNFO,
			CheckIntervalHours: interval,
			Enabled:            true,
		}
		entries := subscriptions.EntriesFromMetadata(meta, req.URL)
		id, err := subscriptions.CreateBaselined(ctx, deps, sub, entries)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "creating subscription failed: " + err.Error()})
			return
		}

		created, err := deps.SubscriptionsRepo.Get(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		collectionName, err := resolveCollectionName(ctx, deps.CollectionsRepo, created.CollectionID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		knownCount, err := deps.SubscriptionsRepo.CountSeenEntries(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		unseenCount, err := deps.SubscriptionsRepo.CountUnseenEntries(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, toSubscriptionResponse(*created, collectionName, knownCount, unseenCount))
	}
}

// resolveCreateInterval applies the create-time rule: omitted or <= 0 falls
// back to the default, anything else must be within the allowed range.
func resolveCreateInterval(requested int) (int, error) {
	if requested <= 0 {
		return subscriptions.DefaultCheckIntervalHours, nil
	}
	if err := subscriptions.ValidateCheckIntervalHours(requested); err != nil {
		return 0, err
	}
	return requested, nil
}

func ListSubscriptions(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		subs, err := deps.SubscriptionsRepo.List(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		cols, err := deps.CollectionsRepo.List(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		names := make(map[int64]string, len(cols))
		for _, col := range cols {
			names[col.ID] = col.Name
		}

		out := make([]SubscriptionResponse, 0, len(subs))
		for _, sub := range subs {
			var collectionName *string
			if sub.CollectionID != nil {
				if n, ok := names[*sub.CollectionID]; ok {
					collectionName = &n
				}
			}
			count, err := deps.SubscriptionsRepo.CountSeenEntries(ctx, sub.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			unseenCount, err := deps.SubscriptionsRepo.CountUnseenEntries(ctx, sub.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			out = append(out, toSubscriptionResponse(sub, collectionName, count, unseenCount))
		}
		c.JSON(http.StatusOK, out)
	}
}

func UpdateSubscription(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req UpdateSubscriptionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		sub, err := deps.SubscriptionsRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if err := subscriptions.ValidateCheckIntervalHours(*req.CheckIntervalHours); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		sub.CollectionID = req.CollectionID
		sub.Tags = req.Tags
		sub.AutoDownload = *req.AutoDownload
		sub.GenerateNFO = *req.GenerateNFO
		sub.CheckIntervalHours = *req.CheckIntervalHours
		sub.Enabled = *req.Enabled

		if err := deps.SubscriptionsRepo.Update(ctx, sub); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		collectionName, err := resolveCollectionName(ctx, deps.CollectionsRepo, sub.CollectionID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		count, err := deps.SubscriptionsRepo.CountSeenEntries(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		unseenCount, err := deps.SubscriptionsRepo.CountUnseenEntries(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, toSubscriptionResponse(*sub, collectionName, count, unseenCount))
	}
}

// CheckSubscriptionNow runs subscriptions.CheckOne synchronously so the
// "Check now" button gets an immediate answer, instead of waiting for the
// next scheduled tick.
func CheckSubscriptionNow(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		sub, err := deps.SubscriptionsRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		newCount, err := subscriptions.CheckOne(ctx, deps, *sub)
		if errors.Is(err, subscriptions.ErrCheckInProgress) {
			c.JSON(http.StatusConflict, gin.H{"error": "This subscription is already being checked. Try again in a moment."})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "checking subscription failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, CheckSubscriptionResponse{NewItemsFound: newCount})
	}
}

// ListSubscriptionEntries backs the "Known items" dialog — every entry
// sub has ever seen, most recent first.
func ListSubscriptionEntries(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if _, err := deps.SubscriptionsRepo.Get(ctx, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		entries, err := deps.SubscriptionsRepo.ListSeenEntries(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// One batched query instead of one FindDuplicate per entry — same
		// approach enqueueBatch already uses for playlist/bulk skipDuplicates.
		queries := make([]repository.DuplicateQuery, len(entries))
		for i, e := range entries {
			queries[i] = repository.DuplicateQuery{URL: e.URL, VideoID: e.SourceID}
		}
		matches, err := deps.LibraryRepo.FindDuplicates(ctx, queries)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// An entry's own library_item_id (whether manually linked or set by
		// a prior ghost/download) is authoritative over the broader URL/
		// video-id soft match — resolve those explicitly-linked items too,
		// deduped since the same item can now be linked from more than one
		// entry.
		linked := make(map[int64]*models.LibraryItem)
		for _, e := range entries {
			if e.LibraryItemID == nil {
				continue
			}
			if _, ok := linked[*e.LibraryItemID]; ok {
				continue
			}
			item, err := deps.LibraryRepo.Get(ctx, *e.LibraryItemID)
			if err != nil {
				log.Printf("subscriptions: resolving linked library item %d failed: %v", *e.LibraryItemID, err)
				continue
			}
			linked[*e.LibraryItemID] = item
		}

		out := make([]SubscriptionEntryResponse, 0, len(entries))
		for i, e := range entries {
			match := matches[i]
			if e.LibraryItemID != nil {
				if item, ok := linked[*e.LibraryItemID]; ok {
					match = item
				}
			}
			out = append(out, toSubscriptionEntryResponse(e, match))
		}
		c.JSON(http.StatusOK, out)
	}
}

// LinkSubscriptionEntry manually associates a "Known items" row with an
// *existing* library item — for when the same video was actually
// downloaded through a different source/URL than the one this subscription
// tracks, so the automatic URL/video-id match could never have found it on
// its own. Also marks the entry seen, same as every other action that
// resolves one (see AddKnownEntryAsGhost/AddKnownEntryAsDownload). The
// same library item can be linked from more than one entry (including
// across different subscriptions) — deliberately unrestricted, since the
// same upload can legitimately appear in more than one tracked source.
func LinkSubscriptionEntry(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		sourceID := c.Param("sourceId")

		var req LinkSubscriptionEntryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if _, err := deps.SubscriptionsRepo.Get(ctx, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := deps.LibraryRepo.Get(ctx, req.LibraryItemID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if err := deps.SubscriptionsRepo.SetSeenEntryLibraryItemID(ctx, id, sourceID, req.LibraryItemID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "entry not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := deps.SubscriptionsRepo.MarkSeenEntry(ctx, id, sourceID); err != nil {
			log.Printf("subscription %d: marking linked entry %q seen failed: %v", id, sourceID, err)
		}
		c.Status(http.StatusNoContent)
	}
}

// resolveCollectionName looks up a single collection's name for a response
// — nil in, nil out; a stale/deleted id (collection removed since the
// subscription was created) resolves to nil rather than erroring, since a
// missing collection name shouldn't block reading the subscription itself.
func resolveCollectionName(ctx context.Context, collectionsRepo *repository.CollectionsRepo, collectionID *int64) (*string, error) {
	if collectionID == nil {
		return nil, nil
	}
	collection, err := collectionsRepo.Get(ctx, *collectionID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &collection.Name, nil
}

// BulkDeleteSubscriptions is POST /api/subscriptions/bulk-delete: it removes the
// listed subscriptions (and, through the cascade, their seen entries) in one
// transaction. Ids that do not exist are ignored; "deleted" counts the rows
// really removed.
func BulkDeleteSubscriptions(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.IDs)) {
			return
		}
		n, err := deps.SubscriptionsRepo.DeleteByIDs(c.Request.Context(), dedupeKeepOrder(req.IDs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, BulkDeleteResponse{Deleted: n})
	}
}

// requireSubscription parses the :id param and answers 400/404/500 itself when
// the subscription cannot be used; ok is false then.
func requireSubscription(c *gin.Context, deps subscriptions.CheckDeps) (*models.Subscription, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return nil, false
	}
	sub, err := deps.SubscriptionsRepo.Get(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	return sub, true
}

// bulkSubscriptionEntries is the shared shell of the entry bulk-seen and
// bulk-unlink endpoints: validate the body, require the subscription, then run
// one transactional repo call and answer {updated}. Source ids that are not
// entries of the subscription are ignored.
func bulkSubscriptionEntries(deps subscriptions.CheckDeps, apply func(ctx context.Context, subID int64, sourceIDs []string) (int, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkSourceIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.SourceIDs)) {
			return
		}
		sub, ok := requireSubscription(c, deps)
		if !ok {
			return
		}
		n, err := apply(c.Request.Context(), sub.ID, dedupeKeepOrder(req.SourceIDs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, BulkUpdatedResponse{Updated: n})
	}
}

// BulkMarkSubscriptionEntriesSeen is POST /api/subscriptions/:id/entries/bulk-seen:
// dismiss the listed Known-items entries (the "+N new" badge).
func BulkMarkSubscriptionEntriesSeen(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return bulkSubscriptionEntries(deps, deps.SubscriptionsRepo.MarkSeenEntries)
}

// BulkUnlinkSubscriptionEntries is POST /api/subscriptions/:id/entries/bulk-unlink:
// clear the manual library link of the listed entries (never touches the
// library items themselves).
func BulkUnlinkSubscriptionEntries(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return bulkSubscriptionEntries(deps, deps.SubscriptionsRepo.UnlinkSeenEntries)
}

// addSubscriptionEntry is the per-entry core of the "Known items" dialog's
// "Add as ghost"/"Queue download" action — a manual version of what a normal
// check does automatically for a new entry (subscriptions.AddKnownEntryAsGhost
// / AddKnownEntryAsDownload). It was the body of the removed single
// .../entries/:sourceId/add handler. Exactly one of the returned ids is set.
func addSubscriptionEntry(ctx context.Context, deps subscriptions.CheckDeps, sub models.Subscription, sourceID, mode string) (libraryItemID, downloadID *int64, e *opError) {
	entry, err := deps.SubscriptionsRepo.GetSeenEntry(ctx, sub.ID, sourceID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, nil, newOpError(http.StatusNotFound, "entry not found")
		}
		return nil, nil, internalOpError(err)
	}
	// Deliberately no "already added" guard — the Known Items dialog
	// itself now confirms before calling this when the entry already
	// has a library match, rather than the backend refusing outright.
	// A fresh ghost/download is always allowed: the same video can
	// legitimately warrant a second copy.
	if entry.URL == "" {
		return nil, nil, newOpError(http.StatusBadRequest, "no URL recorded for this entry — re-check the subscription first")
	}

	switch mode {
	case "ghost":
		id, err := subscriptions.AddKnownEntryAsGhost(ctx, deps, sub, *entry)
		if err != nil {
			return nil, nil, newOpError(http.StatusBadGateway, "adding as ghost item failed: "+err.Error())
		}
		return &id, nil, nil
	case "download":
		id, err := subscriptions.AddKnownEntryAsDownload(ctx, deps, sub, *entry)
		if err != nil {
			return nil, nil, newOpError(http.StatusBadGateway, "queuing download failed: "+err.Error())
		}
		return nil, &id, nil
	}
	return nil, nil, newOpError(http.StatusBadRequest, "invalid mode")
}

// BulkAddSubscriptionEntries is POST /api/subscriptions/:id/entries/bulk-add:
// each entry is added independently (a ghost row or an enqueued download cannot
// be rolled back) and the answer is 200 with one result per source id in
// request order, carrying the new library item or download id on success.
func BulkAddSubscriptionEntries(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkAddSubscriptionEntriesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.SourceIDs)) {
			return
		}
		sub, ok := requireSubscription(c, deps)
		if !ok {
			return
		}
		sourceIDs := dedupeKeepOrder(req.SourceIDs)

		ctx, cancel := detachedBulkContext(c)
		defer cancel()

		resp := newBulkResults[string](len(sourceIDs))
		for _, sid := range sourceIDs {
			libraryID, downloadID, e := addSubscriptionEntry(ctx, deps, *sub, sid, req.Mode)
			if e != nil {
				resp.add(failedResult(sid, e))
				continue
			}
			resp.add(BulkItemResult[string]{ID: sid, OK: true, LibraryItemID: libraryID, DownloadID: downloadID})
		}
		c.JSON(http.StatusOK, resp)
	}
}
