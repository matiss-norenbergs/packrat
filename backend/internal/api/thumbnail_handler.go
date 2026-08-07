package api

import (
	"context"
	"encoding/base64"
	"errors"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/repository"
)

var libraryThumbnailTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

// endOfVideoGraceSeconds keeps the upper end of the pick range a fraction of
// a second short of the true duration — an ffmpeg -ss seek to (or past)
// exact EOF has no frame to return, so "100%" here means "right up to the
// last extractable frame," not the literal boundary.
const endOfVideoGraceSeconds = 0.5

// frameExcludeMinGapSeconds is how close a newly-picked timestamp is allowed
// to land to an already-seen one before it's rejected — two timestamps a
// fraction of a second apart extract the same visual frame anyway, so exact
// float equality isn't the right test for "the same frame."
const frameExcludeMinGapSeconds = 1.0

// pickFrameTimestamps splits the middle 5%-100% of durationSeconds into n
// equal buckets and picks a random point within each — avoids the
// likely-blank intro frame while allowing right up to the end, and repeated
// calls (e.g. Quick Grab used twice) don't keep returning the same frame.
// exclude holds timestamps already returned earlier this session (e.g. from
// previous "get new frames" batches in the choose-thumbnail dialog) — each
// pick retries a bounded number of times to land at least
// frameExcludeMinGapSeconds away from every excluded timestamp; if it can't
// find a clean spot it just keeps its last attempt rather than failing the
// whole batch. Falls back to small fixed offsets when duration is unknown
// (<= 0).
func pickFrameTimestamps(durationSeconds float64, n int, exclude []float64) []float64 {
	out := make([]float64, n)
	if durationSeconds <= 0 {
		for i := range out {
			out[i] = float64(i + 1)
		}
		return out
	}

	lo := durationSeconds * 0.05
	hi := durationSeconds - endOfVideoGraceSeconds
	if hi < lo {
		hi = lo
	}
	bucket := (hi - lo) / float64(n)
	for i := 0; i < n; i++ {
		candidate := lo + bucket*float64(i) + rand.Float64()*bucket
		for attempt := 0; attempt < 10 && tooCloseToAny(candidate, exclude); attempt++ {
			candidate = lo + bucket*float64(i) + rand.Float64()*bucket
		}
		out[i] = candidate
	}
	return out
}

func tooCloseToAny(ts float64, exclude []float64) bool {
	for _, e := range exclude {
		if math.Abs(ts-e) < frameExcludeMinGapSeconds {
			return true
		}
	}
	return false
}

// parseFloatList splits a comma-separated query param into float64s —
// shared by the timestamps/exclude params on GET .../thumbnail/candidates.
func parseFloatList(raw string) ([]float64, error) {
	parts := strings.Split(raw, ",")
	out := make([]float64, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		v, err := strconv.ParseFloat(p, 64)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// thumbnailAbsPathFor returns the sidecar thumbnail path for a media file —
// same basename, .jpg extension — matching the convention already used by
// real downloads (downloader.BuildArgs' --convert-thumbnails jpg) and
// import (findSidecarThumbnail).
func thumbnailAbsPathFor(mediaAbs string) string {
	return strings.TrimSuffix(mediaAbs, filepath.Ext(mediaAbs)) + ".jpg"
}

// resolveDuration returns the item's known duration (seconds) if set, else
// probes mediaAbs on the fly — so an item missing a stored duration (e.g.
// an older import) still gets sensibly spread frame timestamps instead of
// always falling back to the fixed-offset case.
func resolveDuration(ctx context.Context, known *int, mediaAbs, ffprobePath string) float64 {
	if known != nil {
		return float64(*known)
	}
	probe := importer.Probe(ctx, ffprobePath, mediaAbs)
	if probe.DurationSeconds != nil {
		return float64(*probe.DurationSeconds)
	}
	return 0
}

// RedownloadLibraryThumbnail re-fetches just the thumbnail image from the
// item's original URL, overwriting whatever is there now — reuses the same
// YtDlpService.FetchThumbnail already used by Import.
func RedownloadLibraryThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		dir := filepath.Dir(mediaAbs)
		base := strings.TrimSuffix(filepath.Base(mediaAbs), filepath.Ext(mediaAbs))

		thumbPath, err := ytdlp.FetchThumbnail(ctx, *item.OriginalURL, dir, base)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching thumbnail: " + err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, imagesRoot, ytdlp.FFmpegPath, thumbPath)
	}
}

// QuickGrabLibraryThumbnail extracts one frame from the video file at a
// random timestamp and immediately makes it the thumbnail.
func QuickGrabLibraryThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
		ts := pickFrameTimestamps(duration, 1, nil)[0]

		frame, err := ytdlp.ExtractFrame(ctx, mediaAbs, ts)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "grabbing frame: " + err.Error()})
			return
		}

		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if err := os.WriteFile(thumbAbs, frame, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, imagesRoot, ytdlp.FFmpegPath, thumbAbs)
	}
}

// GetLibraryThumbnailCandidates extracts candidate frames spread across the
// video and returns them as base64 JPEGs — read-only, doesn't touch the DB
// or the current thumbnail. The frontend shows them all and the user's pick
// is sent to SetLibraryThumbnail unchanged.
//
// Two modes, both sharing the same response shape:
//   - Default (no "timestamps" param): picks thumbnailFrameCount random
//     timestamps via pickFrameTimestamps. An optional comma-separated
//     "exclude" param carries timestamps already seen in earlier batches
//     this dialog session, so "get new frames" doesn't re-surface the same
//     frame.
//   - Explicit ("timestamps" param set): re-extracts exactly the given
//     comma-separated timestamps instead of picking new ones — how the
//     frontend re-displays a previously-generated batch from its history.
func GetLibraryThumbnailCandidates(mediaRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

		var timestamps []float64
		if raw := c.Query("timestamps"); raw != "" {
			timestamps, err = parseFloatList(raw)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid timestamps: " + err.Error()})
				return
			}
		} else {
			frameCount, err := ThumbnailFrameCount(ctx, settingsRepo)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			var exclude []float64
			if raw := c.Query("exclude"); raw != "" {
				exclude, err = parseFloatList(raw)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid exclude: " + err.Error()})
					return
				}
			}
			duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
			timestamps = pickFrameTimestamps(duration, frameCount, exclude)
		}

		candidates := make([]ThumbnailCandidateResponse, 0, len(timestamps))
		for _, ts := range timestamps {
			frame, err := ytdlp.ExtractFrame(ctx, mediaAbs, ts)
			if err != nil {
				continue // best-effort — skip a failed candidate, don't abort the batch
			}
			candidates = append(candidates, ThumbnailCandidateResponse{
				TimestampSeconds: ts,
				ImageBase64:      base64.StdEncoding.EncodeToString(frame),
			})
		}
		if len(candidates) == 0 {
			c.JSON(http.StatusBadGateway, gin.H{"error": "couldn't extract any frames — this file may not contain a video stream"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"candidates": candidates})
	}
}

// SetLibraryThumbnail writes the given base64 image bytes as the item's
// thumbnail — the finalize step for the "choose from video" flow (the
// frontend sends back exactly the bytes it displayed, so no server-side
// temp state is needed in between).
func SetLibraryThumbnail(mediaRoot, imagesRoot, ffmpegPath string, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req SetLibraryThumbnailRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		data, err := base64.StdEncoding.DecodeString(req.ImageBase64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image data: " + err.Error()})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if err := os.WriteFile(thumbAbs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, imagesRoot, ffmpegPath, thumbAbs)
	}
}

// DeleteLibraryItemThumbnail removes an item's thumbnail — the raw sidecar
// file (if any — a ghost's fetched thumbnail has no MediaRoot-relative
// Thumbnail, only the ImagesRoot derivatives, see fetchGhostThumbnail) and
// both small/medium derivatives — leaving the media file, filename/path,
// and status untouched. The item falls back to MediaTypePlaceholder
// everywhere a thumbnail would've shown.
func DeleteLibraryItemThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.Thumbnail == nil && item.ThumbnailSmallPath == nil && item.ThumbnailMediumPath == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no thumbnail"})
			return
		}

		if item.Thumbnail != nil {
			abs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				log.Printf("library thumbnail: failed to delete %s: %v", abs, err)
			}
		}
		for _, p := range []*string{item.ThumbnailSmallPath, item.ThumbnailMediumPath} {
			if p == nil {
				continue
			}
			abs := filepath.Join(imagesRoot, filepath.FromSlash(*p))
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				log.Printf("library thumbnail: failed to delete derivative %s: %v", abs, err)
			}
		}

		if err := libraryRepo.ClearThumbnail(ctx, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func writeThumbnailAndRespond(c *gin.Context, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, id int64, mediaRoot, imagesRoot, ffmpegPath, thumbAbs string) {
	ctx := c.Request.Context()

	existing, err := libraryRepo.Get(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	thumbRel := toRelSlash(mediaRoot, thumbAbs)
	if err := libraryRepo.UpdateThumbnail(ctx, id, &thumbRel); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, ffmpegPath, imagesRoot, "library", id, thumbAbs, libraryThumbnailTiers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	small, medium := tiers[0], tiers[1]

	// Clean up the old derivatives now that the DB will stop pointing at
	// them (the original sidecar thumbnail itself is left alone here —
	// thumbAbs already overwrote it in place, same file path as before).
	for _, p := range []*string{existing.ThumbnailSmallPath, existing.ThumbnailMediumPath} {
		if p == nil {
			continue
		}
		abs := filepath.Join(imagesRoot, filepath.FromSlash(*p))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("library thumbnail: failed to delete old derivative %s: %v", abs, err)
		}
	}

	if err := libraryRepo.UpdateThumbnailTiers(ctx, id, &small, &medium); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	updated, err := libraryRepo.Get(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var blurred bool
	if updated.CollectionID != nil {
		blurred, err = collectionsRepo.IsPrivate(ctx, *updated.CollectionID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	tags, err := tagsRepo.TagsForLibraryItem(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !blurred {
		blurred, err = tagsRepo.HasPrivateTag(ctx, tags)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, toLibraryItemResponse(*updated, blurred, tags, mediaRoot))
}
