// Package subscriptions periodically re-checks a saved channel/playlist URL
// for new uploads, diffing against what's already been seen. New entries
// either become ghost library items for manual review or, when a
// subscription has auto-download on, go straight into the download queue —
// mirroring CreateGhostLibraryItem (api.ghost_handler) and enqueueDownload
// (api.downloads_handler) respectively, reimplemented here (rather than
// imported) since those live in package api, which will itself import this
// package to wire the "check now" endpoint — importing back would cycle.
package subscriptions

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

var thumbnailTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

type CheckDeps struct {
	SubscriptionsRepo *repository.SubscriptionsRepo
	LibraryRepo       *repository.LibraryRepo
	TagsRepo          *repository.TagsRepo
	CollectionsRepo   *repository.CollectionsRepo
	Manager           *queue.DownloadManager
	YtDlp             *downloader.YtDlpService
	ImagesRoot        string
}

// RunDueChecks is called from the shared hourly ticker in cmd/server/main.go
// (alongside history/download-log cleanup and the scheduled-backup check) —
// finds every enabled subscription whose own check_interval_hours has
// elapsed since its last check and checks each in turn. One subscription
// failing (dead URL, network error) is logged and skipped, never blocks the
// rest — same tolerance backup.RunScheduledBackupIfDue's caller expects.
func RunDueChecks(ctx context.Context, deps CheckDeps) {
	subs, err := deps.SubscriptionsRepo.List(ctx)
	if err != nil {
		log.Printf("subscriptions: listing for scheduled check failed: %v", err)
		return
	}
	for _, sub := range subs {
		if !sub.Enabled {
			continue
		}
		due := sub.LastCheckedAt == nil || time.Since(*sub.LastCheckedAt) >= time.Duration(sub.CheckIntervalHours)*time.Hour
		if !due {
			continue
		}
		if _, err := CheckOne(ctx, deps, sub); err != nil {
			log.Printf("subscription %d (%s): scheduled check failed: %v", sub.ID, sub.URL, err)
		}
	}
}

// CheckOne fetches sub.URL, finds entries not already recorded as seen, and
// for each either enqueues a real download (AutoDownload) or creates a
// ghost library item — then records every new entry as seen and marks the
// subscription checked, regardless of whether anything new was found.
// Exported separately from RunDueChecks so the manual "Check now" button's
// handler can call it directly for immediate feedback.
func CheckOne(ctx context.Context, deps CheckDeps, sub models.Subscription) (int, error) {
	entries, err := fetchEntries(ctx, deps.YtDlp, sub.URL)
	if err != nil {
		// Still mark checked — a subscription whose URL has started failing
		// shouldn't be retried every single tick indefinitely; it gets
		// retried on its next normal interval instead.
		_ = deps.SubscriptionsRepo.MarkChecked(ctx, sub.ID, time.Now())
		return 0, err
	}

	newCount, err := processEntries(ctx, deps, sub, entries, false)
	if err != nil {
		return newCount, err
	}
	if err := deps.SubscriptionsRepo.MarkChecked(ctx, sub.ID, time.Now()); err != nil {
		return newCount, err
	}
	return newCount, nil
}

// BaselineOnCreate is called once, right after a subscription is first
// inserted — it records every entry currently found at sub.URL as already
// seen, without creating any ghost items or downloads. "Subscribing" means
// "tell me about new uploads from now on," not "queue up the entire back
// catalog" — only entries that appear on a later CheckOne are new.
func BaselineOnCreate(ctx context.Context, deps CheckDeps, sub models.Subscription, entries []downloader.PlaylistEntry) error {
	if _, err := processEntries(ctx, deps, sub, entries, true); err != nil {
		return err
	}
	return deps.SubscriptionsRepo.MarkChecked(ctx, sub.ID, time.Now())
}

// fetchEntries normalizes FetchMetadata's result to a flat entry list — a
// URL that resolves to a single video (a channel with exactly one upload,
// or a plain video URL someone subscribed to by mistake) is treated as a
// one-entry "playlist" rather than a special case.
func fetchEntries(ctx context.Context, ytdlp *downloader.YtDlpService, url string) ([]downloader.PlaylistEntry, error) {
	meta, err := ytdlp.FetchMetadata(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("fetching metadata: %w", err)
	}
	return EntriesFromMetadata(meta, url), nil
}

// EntriesFromMetadata is fetchEntries' pure normalization step, exported so
// CreateSubscription (api.subscriptions_handler) can reuse it against a
// metadata fetch it already had to make anyway (to resolve the
// subscription's title), instead of fetching the same URL twice.
func EntriesFromMetadata(meta *downloader.Metadata, url string) []downloader.PlaylistEntry {
	if meta.IsPlaylist() {
		return meta.Entries
	}
	return []downloader.PlaylistEntry{{ID: meta.ID, Title: meta.Title, URL: url, Duration: meta.Duration}}
}

// processEntries diffs entries against what's already recorded as seen for
// sub and handles each new one — baseline skips the create/download step
// entirely (see BaselineOnCreate), a normal check performs it.
func processEntries(ctx context.Context, deps CheckDeps, sub models.Subscription, entries []downloader.PlaylistEntry, baseline bool) (int, error) {
	ids := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.ID != "" {
			ids = append(ids, e.ID)
		}
	}
	seen, err := deps.SubscriptionsRepo.HasSeenEntries(ctx, sub.ID, ids)
	if err != nil {
		return 0, fmt.Errorf("checking seen entries: %w", err)
	}

	newCount := 0
	for _, entry := range entries {
		if entry.ID == "" || seen[entry.ID] {
			continue
		}

		var libraryItemID *int64
		if !baseline {
			if sub.AutoDownload {
				if _, err := enqueueSubscriptionDownload(ctx, deps, sub, entry); err != nil {
					log.Printf("subscription %d: enqueuing %q failed: %v", sub.ID, entry.URL, err)
					continue
				}
			} else {
				id, err := createGhostForEntry(ctx, deps, sub, entry)
				if err != nil {
					log.Printf("subscription %d: creating ghost item for %q failed: %v", sub.ID, entry.URL, err)
					continue
				}
				libraryItemID = &id
			}
			newCount++
		}

		if err := deps.SubscriptionsRepo.RecordSeenEntry(ctx, sub.ID, entry.ID, entry.Title, entry.URL, entry.Duration, libraryItemID); err != nil {
			log.Printf("subscription %d: recording seen entry %q failed: %v", sub.ID, entry.ID, err)
		}
	}
	return newCount, nil
}

// enqueueSubscriptionDownload mirrors enqueueDownload's core
// (api.downloads_handler) — the HTTP-only concerns it also handles
// (URL-scheme validation, folder path-safety) don't apply here: entry.URL
// always comes from yt-dlp itself, and Folder is left empty (resolves to
// the collection/media root, which is always safe).
func enqueueSubscriptionDownload(ctx context.Context, deps CheckDeps, sub models.Subscription, entry downloader.PlaylistEntry) (int64, error) {
	quality := "best"
	if sub.CollectionID != nil {
		if collection, err := deps.CollectionsRepo.Get(ctx, *sub.CollectionID); err == nil && collection.DefaultQuality != "" {
			quality = collection.DefaultQuality
		}
	}
	return deps.Manager.Enqueue(ctx, models.Download{
		URL:          entry.URL,
		CollectionID: sub.CollectionID,
		DownloadType: sub.MediaType,
		Quality:      quality,
		OverrideTags: sub.Tags,
		GenerateNFO:  sub.GenerateNFO,
	})
}

// AddKnownEntryAsGhost and AddKnownEntryAsDownload back the "Known items"
// dialog's per-row actions — a manual, explicit version of what a normal
// check does automatically for a new entry, reusing the exact same
// creation helpers so behavior (tags, thumbnail fetch, quality resolution)
// stays identical either way.
//
// AddKnownEntryAsDownload has no library row to link back to at enqueue
// time (one is only created once the download completes), so — same as the
// existing auto-download path in processEntries — the seen entry's
// library_item_id is deliberately left unset. A downloaded entry keeps
// showing as actionable in the dialog afterward; re-clicking would queue a
// duplicate download. Fixing that would need the download queue to report
// completion back into subscription_seen_entries, which is out of scope
// here.
func AddKnownEntryAsGhost(ctx context.Context, deps CheckDeps, sub models.Subscription, entry models.SubscriptionSeenEntry) (int64, error) {
	id, err := createGhostForEntry(ctx, deps, sub, toPlaylistEntry(entry))
	if err != nil {
		return 0, err
	}
	if err := deps.SubscriptionsRepo.SetSeenEntryLibraryItemID(ctx, sub.ID, entry.SourceID, id); err != nil {
		log.Printf("subscription %d: linking ghost item %d to entry %q failed: %v", sub.ID, id, entry.SourceID, err)
	}
	return id, nil
}

func AddKnownEntryAsDownload(ctx context.Context, deps CheckDeps, sub models.Subscription, entry models.SubscriptionSeenEntry) (int64, error) {
	return enqueueSubscriptionDownload(ctx, deps, sub, toPlaylistEntry(entry))
}

func toPlaylistEntry(entry models.SubscriptionSeenEntry) downloader.PlaylistEntry {
	var duration float64
	if entry.DurationSeconds != nil {
		duration = *entry.DurationSeconds
	}
	return downloader.PlaylistEntry{ID: entry.SourceID, Title: entry.Title, URL: entry.URL, Duration: duration}
}

// createGhostForEntry mirrors CreateGhostLibraryItem's insert (api.ghost_handler)
// — same empty filename/path sentinel, same status, same best-effort
// thumbnail fetch.
func createGhostForEntry(ctx context.Context, deps CheckDeps, sub models.Subscription, entry downloader.PlaylistEntry) (int64, error) {
	mediaType := sub.MediaType
	url := entry.URL
	item := models.LibraryItem{
		Title:        entry.Title,
		Filename:     "",
		Path:         "",
		CollectionID: sub.CollectionID,
		OriginalURL:  &url,
		MediaType:    &mediaType,
		GenerateNFO:  sub.GenerateNFO,
		Status:       "ghost",
	}
	id, err := deps.LibraryRepo.Create(ctx, &item)
	if err != nil {
		return 0, fmt.Errorf("inserting ghost item: %w", err)
	}

	if len(sub.Tags) > 0 {
		tagIDs, err := deps.TagsRepo.GetOrCreateByNames(ctx, sub.Tags)
		if err != nil {
			log.Printf("subscription %d: resolving tags for ghost item %d failed: %v", sub.ID, id, err)
		} else if err := deps.TagsRepo.SetForLibraryItem(ctx, id, tagIDs); err != nil {
			log.Printf("subscription %d: assigning tags to ghost item %d failed: %v", sub.ID, id, err)
		}
	}

	fetchThumbnailForEntry(ctx, deps, id, url)
	return id, nil
}

// fetchThumbnailForEntry mirrors fetchGhostThumbnail (api.ghost_handler) —
// best-effort, failures are logged and otherwise ignored.
func fetchThumbnailForEntry(ctx context.Context, deps CheckDeps, id int64, url string) {
	tmpDir, err := os.MkdirTemp("", "subscription-thumb-*")
	if err != nil {
		log.Printf("subscription ghost item %d: creating scratch dir for thumbnail fetch failed: %v", id, err)
		return
	}
	defer os.RemoveAll(tmpDir)

	thumbAbs, err := deps.YtDlp.FetchThumbnail(ctx, url, tmpDir, "thumb")
	if err != nil {
		log.Printf("subscription ghost item %d: thumbnail fetch failed: %v", id, err)
		return
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, deps.YtDlp.FFmpegPath, deps.ImagesRoot, "library", id, thumbAbs, thumbnailTiers)
	if err != nil {
		log.Printf("subscription ghost item %d: generating thumbnail derivatives failed: %v", id, err)
		return
	}
	if err := deps.LibraryRepo.UpdateThumbnailTiers(ctx, id, &tiers[0], &tiers[1]); err != nil {
		log.Printf("subscription ghost item %d: saving thumbnail derivatives failed: %v", id, err)
	}
}
