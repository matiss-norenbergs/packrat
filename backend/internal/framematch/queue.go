package framematch

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// queuePollInterval is how often RunQueue checks for newly-enqueued work
// when idle — cheap relative to a single match's 60-150s+ runtime, so this
// just bounds the worst-case latency before a freshly bulk-enqueued batch
// starts being worked.
const queuePollInterval = 2 * time.Second

// QueueDeps bundles everything the background queue runner needs.
type QueueDeps struct {
	QueueRepo   *repository.FrameMatchQueueRepo
	LibraryRepo *repository.LibraryRepo
	YtDlp       *downloader.YtDlpService
	FFProbePath string
	MediaRoot   string
	ImagesRoot  string
	Broadcaster ws.Broadcaster
}

// RunQueue processes frame_match_queue rows one at a time for as long as
// ctx is alive — meant to be started once, from cmd/server/main.go, as a
// background goroutine that runs for the whole process lifetime. Idles at
// queuePollInterval whenever nothing's queued. Being the single worker
// (never more than one instance) is what lets NextQueued skip a separate
// row-claiming step.
func RunQueue(ctx context.Context, deps QueueDeps) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		item, err := deps.QueueRepo.NextQueued(ctx)
		if err != nil {
			log.Printf("framematch: polling queue failed: %v", err)
			sleepOrDone(ctx, queuePollInterval)
			continue
		}
		if item == nil {
			sleepOrDone(ctx, queuePollInterval)
			continue
		}
		processQueueItem(ctx, deps, *item)
	}
}

func sleepOrDone(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

func processQueueItem(ctx context.Context, deps QueueDeps, row models.FrameMatchQueueItem) {
	broadcast := func(state string, errMsg *string) {
		if deps.Broadcaster == nil {
			return
		}
		deps.Broadcaster.Broadcast(ws.Event{
			Type: ws.EventFrameMatchProgress,
			Payload: ws.FrameMatchProgressPayload{
				QueueID:       row.ID,
				LibraryItemID: row.LibraryItemID,
				ItemTitle:     row.ItemTitle,
				State:         state,
				Error:         errMsg,
			},
		})
	}
	fail := func(cause error) {
		msg := cause.Error()
		if err := deps.QueueRepo.SetError(ctx, row.ID, msg); err != nil {
			log.Printf("framematch: queue item %d: recording failure failed: %v", row.ID, err)
		}
		broadcast("error", &msg)
	}

	if err := deps.QueueRepo.SetRunning(ctx, row.ID); err != nil {
		log.Printf("framematch: queue item %d: marking running failed: %v", row.ID, err)
		return
	}
	broadcast("running", nil)

	item, err := deps.LibraryRepo.Get(ctx, row.LibraryItemID)
	if err != nil {
		fail(fmt.Errorf("loading item: %w", err))
		return
	}
	if item.Path == "" {
		fail(fmt.Errorf("item has no media file"))
		return
	}

	referenceJPEG, err := ResolveReferenceImage(ctx, deps.YtDlp, deps.MediaRoot, *item, row.Mode)
	if err != nil {
		fail(err)
		return
	}

	videoAbs := filepath.Join(deps.MediaRoot, filepath.FromSlash(item.Path))

	matchMu.Lock()
	result, err := Match(ctx, deps.YtDlp, deps.FFProbePath, videoAbs, referenceJPEG)
	matchMu.Unlock()
	if err != nil {
		fail(err)
		return
	}

	foundRel, refRel, err := persistQueueImages(deps.ImagesRoot, row.ID, result)
	if err != nil {
		fail(fmt.Errorf("saving match images: %w", err))
		return
	}

	if err := deps.QueueRepo.SetDone(ctx, row.ID, result.TimestampSeconds, result.Score, foundRel, refRel); err != nil {
		log.Printf("framematch: queue item %d: recording success failed: %v", row.ID, err)
		return
	}
	broadcast("done", nil)
}

// persistQueueImages writes the found frame and reference image to disk
// under ImagesRoot/frame-match/<queueID>/ — a stable snapshot captured at
// match-completion time, since re-deriving either later (re-fetching the
// source URL, or re-reading the item's now-possibly-different current
// thumbnail) could show something that no longer matches the recorded
// score. Returns paths relative to ImagesRoot, servable via /local-images/*,
// same convention as thumbnail_enhancement_originals.
func persistQueueImages(imagesRoot string, queueID int64, result Result) (foundRel, refRel string, err error) {
	dir := filepath.Join(imagesRoot, "frame-match", fmt.Sprint(queueID))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", fmt.Errorf("creating frame-match dir: %w", err)
	}

	foundBytes, err := base64.StdEncoding.DecodeString(result.ImageBase64)
	if err != nil {
		return "", "", fmt.Errorf("decoding found frame: %w", err)
	}
	refBytes, err := base64.StdEncoding.DecodeString(result.ReferenceImageBase64)
	if err != nil {
		return "", "", fmt.Errorf("decoding reference image: %w", err)
	}

	foundAbs := filepath.Join(dir, "found.jpg")
	refAbs := filepath.Join(dir, "reference.jpg")
	if err := os.WriteFile(foundAbs, foundBytes, 0o644); err != nil {
		return "", "", fmt.Errorf("writing found frame: %w", err)
	}
	if err := os.WriteFile(refAbs, refBytes, 0o644); err != nil {
		return "", "", fmt.Errorf("writing reference image: %w", err)
	}

	foundRelPath, err := filepath.Rel(imagesRoot, foundAbs)
	if err != nil {
		return "", "", err
	}
	refRelPath, err := filepath.Rel(imagesRoot, refAbs)
	if err != nil {
		return "", "", err
	}
	return filepath.ToSlash(foundRelPath), filepath.ToSlash(refRelPath), nil
}
