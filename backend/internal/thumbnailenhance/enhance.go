package thumbnailenhance

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// defaultMaxEnhancementsPerSweep is the fallback for
// SettingThumbnailEnhancementMaxPerSweep when it's never been set — bounds
// how many items one sweep (scheduled or a manual "Enhance now" click)
// processes, so a large backlog can't run unboundedly long against a local,
// often slow, upscaler. User-configurable in Settings → AI Enhancement.
const defaultMaxEnhancementsPerSweep = 5

// failureCooldown is how long an item that just failed is skipped by
// automatic triggers (scheduled sweep, auto-on-download) — matches the
// scheduled sweep's own hourly cadence, giving a natural "try again next
// sweep" window without adding another setting. Manual triggers (the
// eligible-items dialog, bulk-select) ignore this entirely — a user
// deliberately retrying a specific item should always be able to.
const failureCooldown = time.Hour

// enhanceMu serializes every call to enhanceOne, regardless of which
// trigger (scheduled sweep, manual "Enhance now"/per-item click, or
// auto-on-download) initiated it. Without this, two triggers racing on the
// same item could each pass eligibility, then both upscale it — compounding
// the effect instead of one being a harmless no-op. See enhanceOne's
// re-probe immediately after acquiring the lock.
var enhanceMu sync.Mutex

var thumbnailTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

// Deps bundles everything a sweep needs — same shape as
// subscriptions.CheckDeps.
type Deps struct {
	SettingsRepo  *repository.SettingsRepo
	LibraryRepo   *repository.LibraryRepo
	HistoryRepo   *repository.ThumbnailEnhancementHistoryRepo
	OriginalsRepo *repository.ThumbnailEnhancementOriginalsRepo
	MediaRoot     string
	ImagesRoot    string
	FFmpegPath    string
	Broadcaster   ws.Broadcaster
}

type config struct {
	enabled         bool
	scheduleEnabled bool
	url             string
	username        string
	password        string
	upscaler        string
	minDim          int
	factor          int
	targetMode      string // "factor" | "resolution"
	targetDim       int
	// autoApprove, when true, skips backupOriginalIfAbsent — applies
	// globally, to every trigger, not just auto-on-download.
	autoApprove bool
	// autoOnDownload gates MaybeAutoEnhanceOnDownload.
	autoOnDownload bool
	// maxPerSweep bounds runSweep's batch size — see
	// SettingThumbnailEnhancementMaxPerSweep.
	maxPerSweep int
}

// effectiveFactor returns the multiplier to actually request from A1111
// for one specific image. In "factor" mode that's just the configured
// factor; in "resolution" mode it's computed per-image so every enhanced
// thumbnail's longest side lands at targetDim regardless of how far below
// it the original was — clamped to at least 1.0 since asking A1111 to
// downscale isn't this feature's job (shouldn't happen given the minDim
// eligibility gate, but a misconfigured targetDim below minDim is
// possible).
func (c config) effectiveFactor(origW, origH int) float64 {
	if c.targetMode != "resolution" {
		return float64(c.factor)
	}
	longest := origW
	if origH > longest {
		longest = origH
	}
	if longest <= 0 {
		return float64(c.factor)
	}
	f := float64(c.targetDim) / float64(longest)
	if f < 1.0 {
		return 1.0
	}
	return f
}

// loadConfig reads the 7 settings keys, applying the same hardcoded
// defaults GetSettings uses when a key is missing.
func loadConfig(ctx context.Context, settingsRepo *repository.SettingsRepo) config {
	get := func(key, def string) string {
		v, err := settingsRepo.Get(ctx, key)
		if err != nil || v == "" {
			return def
		}
		return v
	}
	minDim, _ := strconv.Atoi(get(models.SettingThumbnailEnhancementMinDim, "720"))
	if minDim <= 0 {
		minDim = 720
	}
	factor, _ := strconv.Atoi(get(models.SettingThumbnailEnhancementFactor, "4"))
	if factor <= 0 {
		factor = 4
	}
	targetMode := get(models.SettingThumbnailEnhancementTargetMode, "factor")
	if targetMode != "resolution" {
		targetMode = "factor"
	}
	targetDim, _ := strconv.Atoi(get(models.SettingThumbnailEnhancementTargetDim, "1920"))
	if targetDim <= 0 {
		targetDim = 1920
	}
	maxPerSweep, _ := strconv.Atoi(get(models.SettingThumbnailEnhancementMaxPerSweep, strconv.Itoa(defaultMaxEnhancementsPerSweep)))
	if maxPerSweep <= 0 {
		maxPerSweep = defaultMaxEnhancementsPerSweep
	}
	return config{
		enabled:         get(models.SettingThumbnailEnhancementEnabled, "false") == "true",
		scheduleEnabled: get(models.SettingThumbnailEnhancementScheduleEnabled, "true") == "true",
		url:             get(models.SettingThumbnailEnhancementURL, ""),
		username:        get(models.SettingThumbnailEnhancementUsername, ""),
		password:        get(models.SettingThumbnailEnhancementPassword, ""),
		upscaler:        get(models.SettingThumbnailEnhancementUpscaler, "R-ESRGAN 4x+"),
		minDim:          minDim,
		factor:          factor,
		targetMode:      targetMode,
		targetDim:       targetDim,
		autoApprove:     get(models.SettingThumbnailEnhancementAutoApprove, "false") == "true",
		autoOnDownload:  get(models.SettingThumbnailEnhancementAutoOnDownload, "false") == "true",
		maxPerSweep:     maxPerSweep,
	}
}

// RunDueEnhancements is called from the shared hourly ticker in
// cmd/server/main.go — no-ops silently if the feature is disabled,
// unconfigured, or its own schedule toggle is off (independent of the
// master enabled flag, so the feature can be used purely on-demand via
// RunOnce without the background sweep ever running), same tolerance
// convention as subscriptions.RunDueChecks.
func RunDueEnhancements(ctx context.Context, deps Deps) {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled || !cfg.scheduleEnabled || cfg.url == "" {
		return
	}
	if _, err := runSweep(ctx, deps, cfg, "scheduled"); err != nil {
		log.Printf("thumbnailenhance: scheduled sweep failed: %v", err)
	}
}

// RunOnce processes up to cfg.maxPerSweep eligible items and returns how
// many were attempted — also the manual "Enhance now" button's
// handler. Unlike RunDueEnhancements, this ignores scheduleEnabled — a
// manual click should always work as long as the feature itself is
// configured, regardless of whether the automatic sweep is turned off.
func RunOnce(ctx context.Context, deps Deps) (int, error) {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled || cfg.url == "" {
		return 0, nil
	}
	return runSweep(ctx, deps, cfg, "manual")
}

// WouldRunCount reports how many items a RunOnce call would process right
// now (findEligible's count, capped at cfg.maxPerSweep, recent failures
// excluded) — used by the "Enhance Now" handler to answer synchronously
// with a queued count before spawning the actual run in the background.
func WouldRunCount(ctx context.Context, deps Deps) (int, error) {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled || cfg.url == "" {
		return 0, nil
	}
	candidates, err := findEligible(ctx, deps, cfg, true)
	if err != nil {
		return 0, err
	}
	if len(candidates) > cfg.maxPerSweep {
		return cfg.maxPerSweep, nil
	}
	return len(candidates), nil
}

// runSweep is RunOnce/RunDueEnhancements' shared body once each has decided
// (via its own gating) that a sweep should actually happen.
func runSweep(ctx context.Context, deps Deps, cfg config, triggerType string) (int, error) {
	candidates, err := findEligible(ctx, deps, cfg, true)
	if err != nil {
		return 0, err
	}

	client := NewClient(cfg.url, cfg.username, cfg.password)

	enhanced := 0
	for _, c := range candidates {
		if enhanced >= cfg.maxPerSweep {
			break
		}
		if err := enhanceOne(ctx, deps, client, cfg, c.item, c.thumbAbs, c.width, c.height, c.size, triggerType); err != nil {
			log.Printf("thumbnailenhance: item %d (%s): %v", c.item.ID, c.item.Title, err)
		}
		enhanced++
	}
	return enhanced, nil
}

// eligibleCandidate is one item findEligible found under the current
// minDim threshold, with its thumbnail already probed so callers don't
// re-read the file.
type eligibleCandidate struct {
	item             models.LibraryItem
	thumbAbs         string
	width            int
	height           int
	size             int64
	artistName       *string
	collectionName   *string
	recentlyFailedAt *time.Time
}

// findEligible scans the whole library for items whose sidecar thumbnail's
// longest side is under cfg.minDim — shared by runSweep (which then caps
// and processes the first cfg.maxPerSweep), ListEligible (which reports
// the full set for the "preview eligible items" dialog, uncapped), and
// EnhanceItems/MaybeAutoEnhanceOnDownload. Every candidate is annotated with
// its most recent failure time (if any, within failureCooldown) regardless
// of skipRecentFailures — only whether it's *filtered out* depends on that
// flag, so a manual trigger can still see and act on it while an automatic
// one skips it.
func findEligible(ctx context.Context, deps Deps, cfg config, skipRecentFailures bool) ([]eligibleCandidate, error) {
	items, err := deps.LibraryRepo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing library: %w", err)
	}

	recentFailures, err := deps.HistoryRepo.RecentlyFailedItemIDs(ctx, time.Now().Add(-failureCooldown))
	if err != nil {
		return nil, fmt.Errorf("loading recent failures: %w", err)
	}

	var out []eligibleCandidate
	for _, item := range items {
		// Ghost items (no media file) have no sidecar thumbnail file to
		// enhance — only WebP derivatives generated from a fetch that never
		// touched disk under MediaRoot.
		if item.Path == "" || item.Thumbnail == nil {
			continue
		}

		thumbAbs := filepath.Join(deps.MediaRoot, filepath.FromSlash(*item.Thumbnail))
		width, height, size, err := probeImage(thumbAbs)
		if err != nil {
			continue // file missing/unreadable — not this sweep's problem to fix
		}
		longest := width
		if height > longest {
			longest = height
		}
		if longest >= cfg.minDim {
			continue // already good enough
		}

		var recentlyFailedAt *time.Time
		if failedAt, ok := recentFailures[item.ID]; ok {
			if skipRecentFailures {
				continue
			}
			t := failedAt
			recentlyFailedAt = &t
		}

		out = append(out, eligibleCandidate{
			item:             item,
			thumbAbs:         thumbAbs,
			width:            width,
			height:           height,
			size:             size,
			artistName:       item.ArtistName,
			collectionName:   item.CollectionName,
			recentlyFailedAt: recentlyFailedAt,
		})
	}
	return out, nil
}

// EligibleItem is one library item currently eligible for enhancement under
// the saved settings — a live snapshot for the "preview eligible items"
// dialog, distinct from a completed attempt's audit row in the history
// table.
type EligibleItem struct {
	LibraryItemID    int64
	ItemTitle        string
	Width            int
	Height           int
	ArtistName       *string
	CollectionName   *string
	RecentlyFailedAt *time.Time
}

// ListEligible reports every item findEligible would currently pick up —
// unlike RunOnce/RunDueEnhancements, not capped at cfg.maxPerSweep, so the
// dialog can show the full backlog even though only the first batch would
// actually be processed on the next "Enhance now" click. Includes recently-
// failed items (unfiltered) so a user can deliberately retry one by hand.
// Returns an empty list (not an error) when the feature is disabled or
// unconfigured, same as a sweep would silently no-op.
func ListEligible(ctx context.Context, deps Deps) ([]EligibleItem, error) {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled {
		return nil, nil
	}
	candidates, err := findEligible(ctx, deps, cfg, false)
	if err != nil {
		return nil, err
	}
	out := make([]EligibleItem, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, EligibleItem{
			LibraryItemID:    c.item.ID,
			ItemTitle:        c.item.Title,
			Width:            c.width,
			Height:           c.height,
			ArtistName:       c.artistName,
			CollectionName:   c.collectionName,
			RecentlyFailedAt: c.recentlyFailedAt,
		})
	}
	return out, nil
}

// EnhanceItems enhances a specific set of library items — the eligible-
// items dialog's "Enhance Selected" bulk action. Unlike RunOnce/
// RunDueEnhancements this bypasses cfg.maxPerSweep entirely: a user
// explicitly picking items shouldn't be capped by a limit that exists to
// bound bulk/background runs. Re-derives eligibility rather than trusting
// the caller, protecting against stale dialog state (e.g. a scheduled
// sweep already enhanced one of these moments ago); ids no longer eligible
// are silently skipped rather than erroring, since a bulk action shouldn't
// abort the rest of the batch over one stale row. Ignores the failure
// cooldown (skipRecentFailures=false) — a deliberate manual selection must
// always be retryable.
func EnhanceItems(ctx context.Context, deps Deps, libraryItemIDs []int64) error {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled || cfg.url == "" {
		return fmt.Errorf("thumbnail enhancement is not enabled/configured")
	}
	candidates, err := findEligible(ctx, deps, cfg, false)
	if err != nil {
		return err
	}
	byID := make(map[int64]eligibleCandidate, len(candidates))
	for _, c := range candidates {
		byID[c.item.ID] = c
	}

	client := NewClient(cfg.url, cfg.username, cfg.password)
	for _, id := range libraryItemIDs {
		c, ok := byID[id]
		if !ok {
			continue
		}
		if err := enhanceOne(ctx, deps, client, cfg, c.item, c.thumbAbs, c.width, c.height, c.size, "manual"); err != nil {
			log.Printf("thumbnailenhance: item %d (%s): %v", c.item.ID, c.item.Title, err)
		}
	}
	return nil
}

// MaybeAutoEnhanceOnDownload is called from a best-effort background
// goroutine right after a fresh download completes (queue.DownloadManager) —
// enhances libraryItemID's thumbnail if the auto-on-download setting is on
// and the item is currently eligible (same minDim gate as every other
// trigger). Unlike EnhanceItem, an ineligible item is not an error: this is
// a background trigger, not a direct user action expecting feedback, same
// tolerance convention as the scheduled sweep.
func MaybeAutoEnhanceOnDownload(ctx context.Context, deps Deps, libraryItemID int64) error {
	cfg := loadConfig(ctx, deps.SettingsRepo)
	if !cfg.enabled || !cfg.autoOnDownload || cfg.url == "" {
		return nil
	}
	candidates, err := findEligible(ctx, deps, cfg, true)
	if err != nil {
		return err
	}
	for _, c := range candidates {
		if c.item.ID != libraryItemID {
			continue
		}
		client := NewClient(cfg.url, cfg.username, cfg.password)
		return enhanceOne(ctx, deps, client, cfg, c.item, c.thumbAbs, c.width, c.height, c.size, "auto")
	}
	return nil
}

// RevertOriginal restores an item's thumbnail to its pre-enhancement
// backup, regenerates derivative tiers, and removes the backup — a
// one-shot undo, not a toggle: once reverted there's nothing left to
// compare against until the item is enhanced again (which creates a fresh
// backup). Also stamps reverted_at on every history row from the cycle
// this backup covers, so the AI Enhancement page can flag them as no
// longer reflecting the item's current thumbnail — see
// ThumbnailEnhancementHistoryRepo.MarkReverted.
func RevertOriginal(ctx context.Context, deps Deps, libraryItemID int64) error {
	backupRel, backupCreatedAt, err := deps.OriginalsRepo.GetWithCreatedAt(ctx, libraryItemID)
	if err != nil {
		return fmt.Errorf("no original backup for item %d: %w", libraryItemID, err)
	}
	item, err := deps.LibraryRepo.Get(ctx, libraryItemID)
	if err != nil {
		return fmt.Errorf("loading item: %w", err)
	}
	if item.Path == "" || item.Thumbnail == nil {
		return fmt.Errorf("item has no thumbnail file")
	}

	backupAbs := filepath.Join(deps.ImagesRoot, filepath.FromSlash(backupRel))
	data, err := os.ReadFile(backupAbs)
	if err != nil {
		return fmt.Errorf("reading original backup: %w", err)
	}

	thumbAbs := filepath.Join(deps.MediaRoot, filepath.FromSlash(*item.Thumbnail))
	if _, _, _, err := writeThumbnailFile(ctx, deps, libraryItemID, thumbAbs, data); err != nil {
		return fmt.Errorf("restoring original: %w", err)
	}

	if err := os.Remove(backupAbs); err != nil && !os.IsNotExist(err) {
		log.Printf("thumbnailenhance: item %d: failed to delete backup file after revert: %v", libraryItemID, err)
	}
	if err := deps.OriginalsRepo.Delete(ctx, libraryItemID); err != nil {
		return err
	}

	// Best-effort — the revert itself already succeeded above; failing to
	// flag the history rows shouldn't surface as a user-facing error.
	if _, err := deps.HistoryRepo.MarkReverted(ctx, libraryItemID, backupCreatedAt); err != nil {
		log.Printf("thumbnailenhance: item %d: marking history reverted failed: %v", libraryItemID, err)
	}
	return nil
}

// DeleteOriginal removes just the backup file/pointer, keeping the
// current (enhanced) thumbnail permanent — disables Compare/Revert for
// this item going forward.
func DeleteOriginal(ctx context.Context, deps Deps, libraryItemID int64) error {
	backupRel, err := deps.OriginalsRepo.Get(ctx, libraryItemID)
	if err != nil {
		return fmt.Errorf("no original backup for item %d: %w", libraryItemID, err)
	}
	backupAbs := filepath.Join(deps.ImagesRoot, filepath.FromSlash(backupRel))
	if err := os.Remove(backupAbs); err != nil && !os.IsNotExist(err) {
		log.Printf("thumbnailenhance: item %d: failed to delete backup file: %v", libraryItemID, err)
	}
	return deps.OriginalsRepo.Delete(ctx, libraryItemID)
}

// DeleteHistoryEntry removes one row from the AI Enhancement history list.
// If that was the last remaining row for the item it referenced, also frees
// that item's original-thumbnail backup (equivalent to calling
// DeleteOriginal): once no history row is left, the UI has no surface left
// to reach Compare/Revert for that item, so keeping the backup around would
// just be unreachable clutter. Deleting one of several rows for an item
// leaves its backup untouched. A missing backup at that point (already
// reverted/deleted, or the entry never had a library item) is not an error.
func DeleteHistoryEntry(ctx context.Context, deps Deps, id int64) error {
	libraryItemID, err := deps.HistoryRepo.Delete(ctx, id)
	if err != nil {
		return err
	}
	if libraryItemID == nil {
		return nil
	}

	remaining, err := deps.HistoryRepo.CountByLibraryItemID(ctx, *libraryItemID)
	if err != nil {
		return err
	}
	if remaining > 0 {
		return nil
	}

	if err := DeleteOriginal(ctx, deps, *libraryItemID); err != nil && !errors.Is(err, repository.ErrNotFound) {
		return err
	}
	return nil
}

// CleanupOldHistory removes history rows created before cutoff — the
// backend for SettingThumbnailEnhancementRetentionDays, mirroring
// cleanupHistory/cleanupDownloadLog in cmd/server/main.go. Any item left
// with zero remaining history rows after the sweep also has its
// original-thumbnail backup freed (same cascade DeleteHistoryEntry applies
// to a single-row delete), so a backup never outlives every record of the
// enhancement that created it.
func CleanupOldHistory(ctx context.Context, deps Deps, cutoff time.Time) (int64, error) {
	n, affectedItemIDs, err := deps.HistoryRepo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	for _, id := range affectedItemIDs {
		remaining, err := deps.HistoryRepo.CountByLibraryItemID(ctx, id)
		if err != nil {
			log.Printf("thumbnailenhance: item %d: checking remaining history after cleanup failed: %v", id, err)
			continue
		}
		if remaining > 0 {
			continue
		}
		if err := DeleteOriginal(ctx, deps, id); err != nil && !errors.Is(err, repository.ErrNotFound) {
			log.Printf("thumbnailenhance: item %d: freeing backup after history cleanup failed: %v", id, err)
		}
	}
	return n, nil
}

// ClearAllHistory backs the AI Enhancement settings tab's "Clear All
// History" button — wipes every history row and, via the same cascade
// CleanupOldHistory already applies per-cutoff, frees every item's
// original-thumbnail backup along with it (nothing would be left to reach
// Compare/Revert from once the history is gone). Returns the number of
// rows deleted.
func ClearAllHistory(ctx context.Context, deps Deps) (int64, error) {
	return CleanupOldHistory(ctx, deps, time.Now())
}

// enhanceOne enhances a single item's thumbnail and records the outcome —
// success or failure — as a history row either way. Serialized by enhanceMu
// across every trigger source: once the lock is acquired, the thumbnail's
// dimensions are re-probed so a second trigger that raced in behind another
// (both having passed eligibility before either acquired the lock) finds
// the item already enhanced and quietly no-ops instead of compounding the
// upscale.
func enhanceOne(ctx context.Context, deps Deps, client *Client, cfg config, item models.LibraryItem, thumbAbs string, origW, origH int, origSize int64, triggerType string) error {
	enhanceMu.Lock()
	defer enhanceMu.Unlock()

	if w, h, _, err := probeImage(thumbAbs); err == nil {
		longest := w
		if h > longest {
			longest = h
		}
		if longest >= cfg.minDim {
			return nil
		}
	}

	broadcast := func(status string, errMsg *string) {
		if deps.Broadcaster == nil {
			return
		}
		deps.Broadcaster.Broadcast(ws.Event{
			Type: ws.EventEnhanceProgress,
			Payload: ws.EnhanceProgressPayload{
				LibraryItemID: item.ID,
				ItemTitle:     item.Title,
				Status:        status,
				Error:         errMsg,
			},
		})
	}
	broadcast("processing", nil)

	entry := &models.ThumbnailEnhancementHistoryEntry{
		LibraryItemID:     &item.ID,
		ItemTitle:         item.Title,
		OriginalWidth:     &origW,
		OriginalHeight:    &origH,
		OriginalSizeBytes: &origSize,
		TriggerType:       triggerType,
	}

	original, err := os.ReadFile(thumbAbs)
	if err != nil {
		return recordFailure(ctx, deps, entry, broadcast, fmt.Errorf("reading original thumbnail: %w", err))
	}

	upscaled, err := client.Upscale(ctx, original, cfg.upscaler, cfg.effectiveFactor(origW, origH))
	if err != nil {
		return recordFailure(ctx, deps, entry, broadcast, fmt.Errorf("upscaling: %w", err))
	}

	if !cfg.autoApprove {
		// Best-effort — a backup failure shouldn't block the enhancement
		// itself, same tolerance the derivative-cleanup step below already
		// gets. Only ever runs once per item: backupOriginalIfAbsent no-ops
		// if a backup already exists, so re-enhancing an item later never
		// clobbers the true original with an already-enhanced version.
		if err := backupOriginalIfAbsent(ctx, deps, item.ID, original); err != nil {
			log.Printf("thumbnailenhance: item %d: backing up original thumbnail failed: %v", item.ID, err)
		}
	}

	newW, newH, newSize, err := writeThumbnailFile(ctx, deps, item.ID, thumbAbs, upscaled)
	if err != nil {
		return recordFailure(ctx, deps, entry, broadcast, fmt.Errorf("writing enhanced thumbnail: %w", err))
	}

	entry.Status = "success"
	entry.EnhancedWidth = &newW
	entry.EnhancedHeight = &newH
	entry.EnhancedSizeBytes = &newSize
	if _, err := deps.HistoryRepo.Create(ctx, entry); err != nil {
		log.Printf("thumbnailenhance: item %d: recording success history failed: %v", item.ID, err)
	}
	broadcast("success", nil)
	return nil
}

func recordFailure(ctx context.Context, deps Deps, entry *models.ThumbnailEnhancementHistoryEntry, broadcast func(status string, errMsg *string), cause error) error {
	entry.Status = "failed"
	msg := cause.Error()
	entry.Error = &msg
	if _, err := deps.HistoryRepo.Create(ctx, entry); err != nil {
		log.Printf("thumbnailenhance: item %d: recording failure history failed: %v", *entry.LibraryItemID, err)
	}
	broadcast("failed", &msg)
	return cause
}

// backupOriginalIfAbsent saves a copy of originalData under
// ImagesRoot/library/<id>/original/<uuid>.jpg — the same layout
// GenerateTiersFromPath uses for its own tiers, including the uuid
// filename for the same cache-busting reason (a revert followed by a
// re-enhance must never reuse a stale browser-cached URL). No-ops if a
// backup already exists for this item, so the original is only ever
// captured once — the true pre-AI version, not whatever it looked like
// before the most recent re-enhancement.
func backupOriginalIfAbsent(ctx context.Context, deps Deps, id int64, originalData []byte) error {
	if _, err := deps.OriginalsRepo.Get(ctx, id); err == nil {
		return nil
	} else if !errors.Is(err, repository.ErrNotFound) {
		return err
	}

	destDir := filepath.Join(deps.ImagesRoot, "library", strconv.FormatInt(id, 10), "original")
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("creating original backup dir: %w", err)
	}
	destAbs := filepath.Join(destDir, uuid.NewString()+".jpg")
	if err := os.WriteFile(destAbs, originalData, 0o644); err != nil {
		return fmt.Errorf("writing original backup: %w", err)
	}
	rel, err := filepath.Rel(deps.ImagesRoot, destAbs)
	if err != nil {
		return fmt.Errorf("computing original backup relative path: %w", err)
	}
	return deps.OriginalsRepo.Create(ctx, id, filepath.ToSlash(rel))
}

// writeThumbnailFile duplicates writeThumbnailAndRespond's core
// (api.thumbnail_handler) — write the new image over the original sidecar
// path, regenerate WebP tiers, update the library row, clean up the old
// derivatives. Gin-context-free so it's callable from a background sweep,
// and shared between enhancement (writes the upscaled result) and revert
// (writes the backed-up original back).
func writeThumbnailFile(ctx context.Context, deps Deps, id int64, thumbAbs string, data []byte) (width, height int, size int64, err error) {
	existing, err := deps.LibraryRepo.Get(ctx, id)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("reloading item: %w", err)
	}

	if err := os.WriteFile(thumbAbs, data, 0o644); err != nil {
		return 0, 0, 0, fmt.Errorf("writing thumbnail file: %w", err)
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, deps.FFmpegPath, deps.ImagesRoot, "library", id, thumbAbs, thumbnailTiers)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("generating thumbnail derivatives: %w", err)
	}
	small, medium := tiers[0], tiers[1]

	for _, p := range []*string{existing.ThumbnailSmallPath, existing.ThumbnailMediumPath} {
		if p == nil {
			continue
		}
		abs := filepath.Join(deps.ImagesRoot, filepath.FromSlash(*p))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("thumbnailenhance: item %d: failed to delete old derivative %s: %v", id, abs, err)
		}
	}

	if err := deps.LibraryRepo.UpdateThumbnailTiers(ctx, id, &small, &medium); err != nil {
		return 0, 0, 0, fmt.Errorf("updating thumbnail tiers: %w", err)
	}

	w, h, s, err := probeImage(thumbAbs)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("probing enhanced thumbnail: %w", err)
	}
	return w, h, s, nil
}

// probeImage reads an image file's dimensions (header only, no full decode)
// and byte size.
func probeImage(abs string) (width, height int, size int64, err error) {
	info, err := os.Stat(abs)
	if err != nil {
		return 0, 0, 0, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return 0, 0, 0, err
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("decoding image header: %w", err)
	}
	return cfg.Width, cfg.Height, info.Size(), nil
}
