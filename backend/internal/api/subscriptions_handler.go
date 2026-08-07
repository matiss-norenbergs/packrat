package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/subscriptions"
)

// defaultSubscriptionCheckIntervalHours is used whenever
// CreateSubscriptionRequest.CheckIntervalHours is omitted/zero.
const defaultSubscriptionCheckIntervalHours = 6

// CreateSubscription saves a channel/playlist URL and immediately baselines
// it (subscriptions.BaselineOnCreate) — every entry currently found is
// recorded as already-seen without creating any ghost items or downloads,
// since "subscribing" means "tell me about new uploads from now on," not
// "queue up the entire back catalog."
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

		meta, err := deps.YtDlp.FetchMetadata(ctx, req.URL)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "couldn't fetch this URL: " + err.Error()})
			return
		}

		title := meta.Title
		if title == "" {
			title = req.URL
		}

		interval := req.CheckIntervalHours
		if interval <= 0 {
			interval = defaultSubscriptionCheckIntervalHours
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
		id, err := deps.SubscriptionsRepo.Create(ctx, &sub)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		sub.ID = id

		entries := subscriptions.EntriesFromMetadata(meta, req.URL)
		if err := subscriptions.BaselineOnCreate(ctx, deps, sub, entries); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "subscription saved, but baselining failed: " + err.Error()})
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

func DeleteSubscription(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := deps.SubscriptionsRepo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
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
		out := make([]SubscriptionEntryResponse, 0, len(entries))
		for _, e := range entries {
			out = append(out, toSubscriptionEntryResponse(e))
		}
		c.JSON(http.StatusOK, out)
	}
}

// AddSubscriptionEntry is the "Known items" dialog's per-row "Add as
// ghost"/"Queue download" action — a manual version of what a normal check
// does automatically for a new entry (subscriptions.AddKnownEntryAsGhost /
// AddKnownEntryAsDownload).
func AddSubscriptionEntry(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		sourceID := c.Param("sourceId")

		var req AddSubscriptionEntryRequest
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
		entry, err := deps.SubscriptionsRepo.GetSeenEntry(ctx, id, sourceID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "entry not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if entry.LibraryItemID != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "this entry has already been added to the library"})
			return
		}
		if entry.URL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no URL recorded for this entry — re-check the subscription first"})
			return
		}

		resp := AddSubscriptionEntryResponse{Mode: req.Mode}
		switch req.Mode {
		case "ghost":
			libraryItemID, err := subscriptions.AddKnownEntryAsGhost(ctx, deps, *sub, *entry)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "adding as ghost item failed: " + err.Error()})
				return
			}
			resp.LibraryItemID = &libraryItemID
		case "download":
			downloadID, err := subscriptions.AddKnownEntryAsDownload(ctx, deps, *sub, *entry)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "queuing download failed: " + err.Error()})
				return
			}
			resp.DownloadID = &downloadID
		}
		c.JSON(http.StatusOK, resp)
	}
}

// MarkSubscriptionEntrySeen is the Known Items dialog's "Mark seen" button
// — a manual dismiss for an entry the user has noticed but doesn't want to
// act on right now.
func MarkSubscriptionEntrySeen(deps subscriptions.CheckDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		sourceID := c.Param("sourceId")

		if _, err := deps.SubscriptionsRepo.Get(ctx, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if err := deps.SubscriptionsRepo.MarkSeenEntry(ctx, id, sourceID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "entry not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
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
