package api

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"packrat/backend/internal/models"
	"packrat/backend/internal/nfo"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// libraryItemArtifacts is everything a delete handler must capture about a
// library item BEFORE its row is deleted: the row itself (paths) and the
// frame_match_queue ids, which cascade away with the row and so can't be
// looked up afterwards.
type libraryItemArtifacts struct {
	Item     *models.LibraryItem
	QueueIDs []int64
}

// collectLibraryItemArtifacts snapshots item's frame-match queue ids. Call it
// (inside the tx, for bulk) before deleting the row; pass the result to
// purgeLibraryItemArtifacts once the delete has committed.
func collectLibraryItemArtifacts(ctx context.Context, repo *repository.LibraryRepo, item *models.LibraryItem) (libraryItemArtifacts, error) {
	ids, err := repo.FrameMatchQueueIDs(ctx, item.ID)
	if err != nil {
		return libraryItemArtifacts{}, err
	}
	return libraryItemArtifacts{Item: item, QueueIDs: ids}, nil
}

// purgeLibraryItemArtifacts best-effort removes everything on disk that
// belonged to a deleted library item: its ImagesRoot directories
// (library/<id> — thumbnail tiers and the AI-enhancement "original" backup,
// thumbnail-gallery/<id>, frame-match/<queueId>) always, plus — when
// deleteFiles is set — the media file, its MediaRoot thumbnail and its .nfo
// sidecar. IDs are AUTOINCREMENT so the directories are never reused and are
// removed wholesale. Must only run after the DB delete has succeeded. Failures
// are logged, never returned; a missing path counts as success.
func purgeLibraryItemArtifacts(mediaRoot, imagesRoot string, a libraryItemArtifacts, deleteFiles bool) {
	item := a.Item
	if deleteFiles {
		removeMediaAndSidecars(mediaRoot, item, true)
	}

	id := strconv.FormatInt(item.ID, 10)
	removeDirBestEffort(filepath.Join(imagesRoot, "library", id))
	removeDirBestEffort(filepath.Join(imagesRoot, "thumbnail-gallery", id))
	for _, qid := range a.QueueIDs {
		removeDirBestEffort(filepath.Join(imagesRoot, "frame-match", strconv.FormatInt(qid, 10)))
	}
}

// purgeLibraryItemFileArtifacts is the delete-file counterpart (row stays,
// only the file is detached): removes the media file and its .nfo sidecar
// always, and when deleteThumbnail is set also the MediaRoot thumbnail, the
// ImagesRoot WebP tiers and the AI-enhancement original. Run after the
// ClearFile update has committed. item is the pre-clear snapshot.
func purgeLibraryItemFileArtifacts(ctx context.Context, mediaRoot, imagesRoot string, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, item *models.LibraryItem, deleteThumbnail bool) {
	removeMediaAndSidecars(mediaRoot, item, deleteThumbnail)
	if !deleteThumbnail {
		return
	}
	removeThumbnailTiers(imagesRoot, item.ThumbnailSmallPath, item.ThumbnailMediumPath)
	removeEnhancementOriginal(ctx, originalsRepo, imagesRoot, item.ID)
}

// removeMediaAndSidecars removes item's media file and .nfo sidecar, and
// (when withThumbnail) its MediaRoot-relative thumbnail. A ghost (empty Path)
// has no media file — joining "" onto mediaRoot would target the root itself.
func removeMediaAndSidecars(mediaRoot string, item *models.LibraryItem, withThumbnail bool) {
	if item.Path != "" {
		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		removeFileBestEffort(mediaAbs, "media file")
		removeFileBestEffort(nfo.SidecarPath(mediaAbs), "nfo sidecar")
	}
	if withThumbnail && item.Thumbnail != nil {
		removeFileBestEffort(filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail)), "thumbnail")
	}
}

// removeThumbnailTiers removes ImagesRoot-relative derivative files.
func removeThumbnailTiers(imagesRoot string, rels ...*string) {
	for _, p := range rels {
		if p == nil || *p == "" {
			continue
		}
		removeFileBestEffort(filepath.Join(imagesRoot, filepath.FromSlash(*p)), "thumbnail derivative")
	}
}

// removeEnhancementOriginal drops an item's AI-enhancement backup (file +
// pointer row); ErrNotFound just means it was never enhanced.
func removeEnhancementOriginal(ctx context.Context, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, imagesRoot string, id int64) {
	if originalsRepo == nil {
		return
	}
	deps := thumbnailenhance.Deps{OriginalsRepo: originalsRepo, ImagesRoot: imagesRoot}
	if err := thumbnailenhance.DeleteOriginal(ctx, deps, id); err != nil && !errors.Is(err, repository.ErrNotFound) {
		log.Printf("library: failed to delete AI-enhancement original for item %d: %v", id, err)
	}
}

func removeFileBestEffort(abs, what string) {
	if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
		log.Printf("library: failed to delete %s %s: %v", what, abs, err)
	}
}

// removeDirBestEffort removes dir and everything under it (os.RemoveAll
// already treats a missing dir as success).
func removeDirBestEffort(dir string) {
	if err := os.RemoveAll(dir); err != nil {
		log.Printf("library: failed to remove directory %s: %v", dir, err)
	}
}
