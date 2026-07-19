package api

import (
	"context"
	"encoding/base64"
	"errors"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/repository"
)

// pickFrameTimestamps splits the middle 10%-90% of durationSeconds into n
// equal buckets and picks a random point within each — avoids the
// likely-blank intro/outro frames, and repeated calls (e.g. Quick Grab used
// twice) don't keep returning the same frame. Falls back to small fixed
// offsets when duration is unknown (<= 0).
func pickFrameTimestamps(durationSeconds float64, n int) []float64 {
	out := make([]float64, n)
	if durationSeconds <= 0 {
		for i := range out {
			out[i] = float64(i + 1)
		}
		return out
	}

	lo, hi := durationSeconds*0.1, durationSeconds*0.9
	bucket := (hi - lo) / float64(n)
	for i := 0; i < n; i++ {
		out[i] = lo + bucket*float64(i) + rand.Float64()*bucket
	}
	return out
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
func RedownloadLibraryThumbnail(mediaRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		dir := filepath.Dir(mediaAbs)
		base := strings.TrimSuffix(filepath.Base(mediaAbs), filepath.Ext(mediaAbs))

		thumbPath, err := ytdlp.FetchThumbnail(ctx, *item.OriginalURL, dir, base)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching thumbnail: " + err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, thumbPath)
	}
}

// QuickGrabLibraryThumbnail extracts one frame from the video file at a
// random timestamp and immediately makes it the thumbnail.
func QuickGrabLibraryThumbnail(mediaRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
		ts := pickFrameTimestamps(duration, 1)[0]

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

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, thumbAbs)
	}
}

// GetLibraryThumbnailCandidates extracts 4 candidate frames spread across
// the video and returns them as base64 JPEGs — read-only, doesn't touch the
// DB or the current thumbnail. The frontend shows all 4 and the user's pick
// is sent to SetLibraryThumbnail unchanged.
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

		frameCount, err := ThumbnailFrameCount(ctx, settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
		timestamps := pickFrameTimestamps(duration, frameCount)

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
func SetLibraryThumbnail(mediaRoot string, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
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

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, id, mediaRoot, thumbAbs)
	}
}

func writeThumbnailAndRespond(c *gin.Context, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, id int64, mediaRoot, thumbAbs string) {
	ctx := c.Request.Context()
	thumbRel := toRelSlash(mediaRoot, thumbAbs)
	if err := libraryRepo.UpdateThumbnail(ctx, id, &thumbRel); err != nil {
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
