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
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/features"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
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
	// SettingsRepo is read only by RunDueChecks, to honour the Subscriptions
	// feature toggle. Nil means "always on".
	SettingsRepo *repository.SettingsRepo
	// Broadcaster is used only by RunDueChecks (the scheduled sweep) to
	// report new items found — the manual "Check now" HTTP handler already
	// gets its count synchronously via the response, so it doesn't need this.
	Broadcaster ws.Broadcaster
	// FetchEntries overrides the yt-dlp listing fetch. Nil (production) uses
	// YtDlp; tests inject a stub.
	FetchEntries func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error)
}

var sweepMu sync.Mutex

// checkLocks serializes checks per subscription id: the sweep and "Check now"
// (and two "Check now" clicks) must never process the same subscription at
// once. Always taken with TryLock — never blocks.
var checkLocks = itemlock.New()

// ErrCheckInProgress is returned by CheckOne when the subscription is already
// being checked. "Check now" maps it to 409; the sweep just skips.
var ErrCheckInProgress = errors.New("subscription is already being checked")

// Allowed range for a subscription's check interval.
const (
	DefaultCheckIntervalHours = 6
	MinCheckIntervalHours     = 1
	MaxCheckIntervalHours     = 8760 // one year
)

// ValidateCheckIntervalHours reports whether h is a storable interval.
func ValidateCheckIntervalHours(h int) error {
	if h < MinCheckIntervalHours || h > MaxCheckIntervalHours {
		return fmt.Errorf("checkIntervalHours must be between %d and %d", MinCheckIntervalHours, MaxCheckIntervalHours)
	}
	return nil
}

// checkInterval converts a stored interval to a Duration, clamping to the
// allowed range so a bad value already in the database (0, negative, or huge
// enough to overflow time.Duration) can't make a subscription due on every
// tick or wrap around.
func checkInterval(hours int) time.Duration {
	if hours < MinCheckIntervalHours {
		hours = MinCheckIntervalHours
	}
	if hours > MaxCheckIntervalHours {
		hours = MaxCheckIntervalHours
	}
	return time.Duration(hours) * time.Hour
}

// RunDueChecks is called from the shared hourly ticker in cmd/server/main.go
// (alongside history/download-log cleanup and the scheduled-backup check) —
// finds every enabled subscription whose own check_interval_hours has
// elapsed since its last check and checks each in turn. One subscription
// failing (dead URL, network error) is logged and skipped, never blocks the
// rest — same tolerance backup.RunScheduledBackupIfDue's caller expects.
//
// Does nothing while the Subscriptions feature is off. Nothing is marked as
// checked in that case, so every due subscription runs on the first sweep
// after the feature comes back on (the settings handler triggers one
// immediately). Overlapping sweeps (the hourly tick racing that immediate
// one) are skipped rather than queued, so a subscription is never checked
// twice at once.
func RunDueChecks(ctx context.Context, deps CheckDeps) {
	if !features.Enabled(ctx, deps.SettingsRepo, models.SettingFeatureSubscriptionsEnabled) {
		return
	}
	if !sweepMu.TryLock() {
		return
	}
	defer sweepMu.Unlock()
	subs, err := deps.SubscriptionsRepo.List(ctx)
	if err != nil {
		log.Printf("subscriptions: listing for scheduled check failed: %v", err)
		return
	}
	for _, sub := range subs {
		if !sub.Enabled {
			continue
		}
		due := sub.LastCheckedAt == nil || time.Since(*sub.LastCheckedAt) >= checkInterval(sub.CheckIntervalHours)
		if !due {
			continue
		}
		newCount, err := CheckOne(ctx, deps, sub)
		if errors.Is(err, ErrCheckInProgress) {
			log.Printf("subscription %d (%s): already being checked, skipping this sweep", sub.ID, sub.URL)
			continue
		}
		if err != nil {
			log.Printf("subscription %d (%s): scheduled check failed: %v", sub.ID, sub.URL, err)
			continue
		}
		if newCount > 0 && deps.Broadcaster != nil {
			deps.Broadcaster.Broadcast(ws.Event{
				Type: ws.EventSubscriptionNewItems,
				Payload: ws.SubscriptionNewItemsPayload{
					SubscriptionID:    sub.ID,
					SubscriptionTitle: sub.Title,
					NewCount:          newCount,
				},
			})
		}
	}
}

// CheckOne fetches sub.URL, finds entries not already recorded as seen, and
// for each either enqueues a real download (AutoDownload) or creates a
// ghost library item — then records every new entry as seen and marks the
// subscription checked, regardless of whether anything new was found.
// Exported separately from RunDueChecks so the manual "Check now" button's
// handler can call it directly for immediate feedback.
//
// Only one check per subscription runs at a time: a concurrent call returns
// ErrCheckInProgress immediately instead of waiting. sub is re-read once the
// lock is held, so a call that queued behind another check never acts on a
// stale snapshot (notably LastCheckedAt).
func CheckOne(ctx context.Context, deps CheckDeps, sub models.Subscription) (int, error) {
	if !checkLocks.TryLock(sub.ID) {
		return 0, ErrCheckInProgress
	}
	defer checkLocks.Unlock(sub.ID)

	fresh, err := deps.SubscriptionsRepo.Get(ctx, sub.ID)
	if err != nil {
		return 0, err
	}
	sub = *fresh

	entries, err := fetchEntries(ctx, deps, sub.URL)
	if err != nil {
		// Still mark checked — a subscription whose URL has started failing
		// shouldn't be retried every single tick indefinitely; it gets
		// retried on its next normal interval instead. The error message
		// itself is recorded too, so the "Last checked" column's warning
		// badge has something to show.
		errMsg := err.Error()
		_ = deps.SubscriptionsRepo.MarkChecked(ctx, sub.ID, time.Now(), &errMsg)
		return 0, err
	}

	if sub.LastCheckedAt == nil {
		// Never baselined: the subscription row was committed but its
		// baseline never finished (older versions inserted the row before
		// baselining). Acting on the whole unrecorded back catalog would
		// flood the library, so this run only records what is there now.
		log.Printf("subscription %d (%s): never baselined, recording %d current entries as seen instead of acting on them", sub.ID, sub.URL, len(entries))
		return 0, BaselineOnCreate(ctx, deps, sub, entries)
	}

	newCount, err := processEntries(ctx, deps, sub, entries, false)
	if err != nil {
		return newCount, err
	}
	if err := deps.SubscriptionsRepo.MarkChecked(ctx, sub.ID, time.Now(), nil); err != nil {
		return newCount, err
	}
	return newCount, nil
}

// baselineTimeout bounds the detached baseline transaction.
const baselineTimeout = 2 * time.Minute

// seenInputs converts entries to unique, http(s)-only bulk-insert rows
// (first occurrence wins; same filtering processEntries applies).
func seenInputs(entries []downloader.PlaylistEntry) []repository.SeenEntryInput {
	out := make([]repository.SeenEntryInput, 0, len(entries))
	handled := make(map[string]bool, len(entries))
	for _, e := range entries {
		id := sourceID(e)
		if id == "" || handled[id] || !queue.IsHTTPURL(e.URL) {
			continue
		}
		handled[id] = true
		out = append(out, repository.SeenEntryInput{SourceID: id, Title: e.Title, URL: e.URL, Duration: e.Duration})
	}
	return out
}

// CreateBaselined inserts sub, records every current entry as already seen
// and stamps last_checked_at in ONE transaction (all or nothing), returning
// the new id. "Subscribing" means "tell me about new uploads from now on", so
// no ghosts or downloads are created for the existing back catalog. The
// transaction runs on a context that survives the client disconnecting, so
// closing the tab can't abort it halfway; the slow metadata fetch happens
// before this, outside the transaction.
func CreateBaselined(ctx context.Context, deps CheckDeps, sub models.Subscription, entries []downloader.PlaylistEntry) (int64, error) {
	txCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), baselineTimeout)
	defer cancel()
	return deps.SubscriptionsRepo.CreateWithSeenEntries(txCtx, &sub, seenInputs(entries), time.Now())
}

// BaselineOnCreate records every entry currently found at sub.URL as already
// seen for an existing subscription, without creating any ghost items or
// downloads, and marks it checked — in one transaction via the shared bulk
// path. New subscriptions go through CreateBaselined; this is the healing
// path for one that was never baselined (see CheckOne).
func BaselineOnCreate(ctx context.Context, deps CheckDeps, sub models.Subscription, entries []downloader.PlaylistEntry) error {
	txCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), baselineTimeout)
	defer cancel()
	return deps.SubscriptionsRepo.RecordSeenEntries(txCtx, sub.ID, seenInputs(entries), time.Now())
}

// fetchEntries normalizes FetchMetadata's result to a flat entry list — a
// URL that resolves to a single video (a channel with exactly one upload,
// or a plain video URL someone subscribed to by mistake) is treated as a
// one-entry "playlist" rather than a special case.
func fetchEntries(ctx context.Context, deps CheckDeps, url string) ([]downloader.PlaylistEntry, error) {
	if deps.FetchEntries != nil {
		return deps.FetchEntries(ctx, url)
	}
	meta, err := deps.YtDlp.FetchMetadata(ctx, url)
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

// linkTimeout bounds the follow-up write that links a claimed entry to the
// library item its action created.
const linkTimeout = 10 * time.Second

// processEntries diffs entries against what's already recorded as seen for
// sub and handles each new one — baseline skips the create/download step
// entirely, a normal check performs it.
//
// Claim-then-act: each entry is first CLAIMED by inserting its seen row
// (INSERT OR IGNORE on UNIQUE (subscription_id, source_id)); only the caller
// whose insert actually created the row performs the ghost/download action.
// Overlapping checks and ids repeated within a listing therefore act at most
// once. Trade-off, chosen on purpose: a crash between the claim and the
// action loses that single entry (it is recorded as seen but never acted on)
// instead of duplicating it. The action's result is then linked to the
// claimed row on a context that survives cancellation.
func processEntries(ctx context.Context, deps CheckDeps, sub models.Subscription, entries []downloader.PlaylistEntry, baseline bool) (int, error) {
	ids := make([]string, 0, len(entries))
	for _, e := range entries {
		if id := sourceID(e); id != "" {
			ids = append(ids, id)
		}
	}
	// Cheap prefilter so already-known entries cost one query, not one write
	// each; the claim below is what actually guarantees exactly-once.
	seen, err := deps.SubscriptionsRepo.HasSeenEntries(ctx, sub.ID, ids)
	if err != nil {
		return 0, fmt.Errorf("checking seen entries: %w", err)
	}

	newCount := 0
	handled := make(map[string]bool, len(entries))
	for _, entry := range entries {
		id := sourceID(entry)
		if id == "" || seen[id] || handled[id] {
			continue
		}
		handled[id] = true
		if !queue.IsHTTPURL(entry.URL) {
			log.Printf("subscription %d: skipping entry %q: not an http(s) URL", sub.ID, id)
			continue
		}

		claimed, err := deps.SubscriptionsRepo.ClaimSeenEntry(ctx, sub.ID, id, entry.Title, entry.URL, entry.Duration)
		if err != nil {
			// Not claimed, so not acted on: the next check retries it.
			log.Printf("subscription %d: claiming entry %q failed: %v", sub.ID, id, err)
			continue
		}
		if !claimed || baseline {
			continue
		}

		var libraryItemID *int64
		if sub.AutoDownload {
			if _, err := enqueueSubscriptionDownload(ctx, deps, sub, entry); err != nil {
				// The entry stays recorded (claimed above) with no
				// library_item_id. That is what makes it show up in Known
				// Items and what stops every future check from retrying the
				// exact same failure forever (bad audio format, dead URL, ...).
				log.Printf("subscription %d: enqueuing %q failed: %v", sub.ID, entry.URL, err)
			} else {
				newCount++
			}
		} else {
			itemID, err := createGhostForEntry(ctx, deps, sub, entry)
			if err != nil {
				// Same reasoning as the enqueue-failure case above.
				log.Printf("subscription %d: creating ghost item for %q failed: %v", sub.ID, entry.URL, err)
			} else {
				libraryItemID = &itemID
				newCount++
			}
		}

		if libraryItemID != nil {
			linkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), linkTimeout)
			if err := deps.SubscriptionsRepo.SetSeenEntryLibraryItemID(linkCtx, sub.ID, id, *libraryItemID); err != nil {
				log.Printf("subscription %d: linking ghost item %d to entry %q failed: %v", sub.ID, *libraryItemID, id, err)
			}
			cancel()
		}
	}
	return newCount, nil
}

// sourceID picks the stable identifier processEntries dedups/records an
// entry under: entry.ID when the extractor's flat-playlist output actually
// provides one, entry.URL otherwise. Not every extractor does — some sites'
// channel/listing pages only ever populate url/title/ie_key, never id — and
// entry.ID being permanently "" for an entire source would mean every entry
// from it fails the "have we seen this?" check forever, since there'd be
// nothing to key it by: baselining, automatic checks, and manual "Check now"
// would all silently record zero entries no matter how many videos the
// source actually has.
func sourceID(entry downloader.PlaylistEntry) string {
	if entry.ID != "" {
		return entry.ID
	}
	return entry.URL
}

// enqueueSubscriptionDownload mirrors enqueueDownload's core
// (api.downloads_handler) — the HTTP-only concerns it also handles
// (folder path-safety) don't apply here: URL schemes are enforced by
// Enqueue and by processEntries, and Folder is left empty (resolves to
// the collection/media root, which is always safe).
func enqueueSubscriptionDownload(ctx context.Context, deps CheckDeps, sub models.Subscription, entry downloader.PlaylistEntry) (int64, error) {
	quality := "best"
	if sub.CollectionID != nil {
		if collection, err := deps.CollectionsRepo.Get(ctx, *sub.CollectionID); err == nil && collection.DefaultQuality != "" {
			quality = collection.DefaultQuality
		}
	}
	d := models.Download{
		URL:          entry.URL,
		CollectionID: sub.CollectionID,
		DownloadType: sub.MediaType,
		Quality:      quality,
		OverrideTags: sub.Tags,
		GenerateNFO:  sub.GenerateNFO,
	}
	// Mirrors enqueueDownload's (api.downloads_handler) own "mp3" default —
	// unlike that HTTP path, nothing here ever prompts for a format, so an
	// audio subscription must default one itself or yt-dlp gets handed
	// --audio-format "" and rejects it outright.
	if sub.MediaType == "audio" {
		audioFormat := "mp3"
		d.AudioFormat = &audioFormat
	}
	return deps.Manager.Enqueue(ctx, d)
}

// AddKnownEntryAsGhost and AddKnownEntryAsDownload back the "Known items"
// dialog's per-row actions — a manual, explicit version of what a normal
// check does automatically for a new entry, reusing the exact same
// creation helpers so behavior (tags, thumbnail fetch, quality resolution)
// stays identical either way. Both also mark the entry seen — acting on it
// is a stronger signal than the dialog's own "Mark seen" button, and doing
// so here means the unseen count only ever reflects entries nobody has
// looked at or touched, not ones just still lacking a library_item_id.
//
// AddKnownEntryAsDownload has no library row to link back to at enqueue
// time (one is only created once the download completes), so — same as the
// existing auto-download path in processEntries — the seen entry's
// library_item_id is deliberately left unset. A downloaded entry keeps
// showing as actionable in the dialog afterward (though no longer flagged
// "New"); re-clicking would queue a duplicate download. Fixing that would
// need the download queue to report completion back into
// subscription_seen_entries, which is out of scope here.
func AddKnownEntryAsGhost(ctx context.Context, deps CheckDeps, sub models.Subscription, entry models.SubscriptionSeenEntry) (int64, error) {
	id, err := createGhostForEntry(ctx, deps, sub, toPlaylistEntry(entry))
	if err != nil {
		return 0, err
	}
	// Only claims the entry's link if it doesn't already have one — an
	// entry can already be linked here (a prior ghost/download, or a
	// manual "Link to library item…") when this runs as the "add another
	// anyway" path off a confirmed duplicate; that existing, presumably
	// deliberate association shouldn't be silently reassigned to whatever
	// fresh copy just got created.
	if entry.LibraryItemID == nil {
		if err := deps.SubscriptionsRepo.SetSeenEntryLibraryItemID(ctx, sub.ID, entry.SourceID, id); err != nil {
			log.Printf("subscription %d: linking ghost item %d to entry %q failed: %v", sub.ID, id, entry.SourceID, err)
		}
	}
	if err := deps.SubscriptionsRepo.MarkSeenEntry(ctx, sub.ID, entry.SourceID); err != nil {
		log.Printf("subscription %d: marking entry %q seen failed: %v", sub.ID, entry.SourceID, err)
	}
	return id, nil
}

func AddKnownEntryAsDownload(ctx context.Context, deps CheckDeps, sub models.Subscription, entry models.SubscriptionSeenEntry) (int64, error) {
	id, err := enqueueSubscriptionDownload(ctx, deps, sub, toPlaylistEntry(entry))
	if err != nil {
		return 0, err
	}
	if err := deps.SubscriptionsRepo.MarkSeenEntry(ctx, sub.ID, entry.SourceID); err != nil {
		log.Printf("subscription %d: marking entry %q seen failed: %v", sub.ID, entry.SourceID, err)
	}
	return id, nil
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
	if !queue.IsHTTPURL(url) {
		return
	}
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
	var width, height *int
	if w, h, err := imageproc.ProbeDimensions(thumbAbs); err != nil {
		log.Printf("subscription ghost item %d: probing thumbnail dimensions failed: %v", id, err)
	} else {
		width, height = &w, &h
	}
	if err := deps.LibraryRepo.UpdateThumbnailTiers(ctx, id, &tiers[0], &tiers[1], width, height); err != nil {
		log.Printf("subscription ghost item %d: saving thumbnail derivatives failed: %v", id, err)
	}
}
