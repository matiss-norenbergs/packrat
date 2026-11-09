package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
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
	"packrat/backend/internal/importer"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
	"packrat/backend/internal/thumbwrite"
)

// libraryThumbnailTiers is the one shared tier set (see thumbwrite.Tiers).
var libraryThumbnailTiers = thumbwrite.Tiers

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

// pickFrameTimestamps splits the [lowPercent, highPercent] portion of
// durationSeconds (each 0-100, as fractions of the total duration) into n
// equal buckets and picks a random point within each — the default 5-100
// avoids the likely-blank intro frame while allowing right up to the end,
// and repeated calls (e.g. Quick Grab used twice) don't keep returning the
// same frame. The upper bound is always additionally clamped to
// endOfVideoGraceSeconds short of the true duration regardless of
// highPercent, since an ffmpeg seek to/past exact EOF has no frame to
// return. exclude holds timestamps already returned earlier this session
// (e.g. from previous "get new frames" batches in the choose-thumbnail
// dialog) — each pick retries a bounded number of times to land at least
// frameExcludeMinGapSeconds away from every excluded timestamp; if it can't
// find a clean spot it just keeps its last attempt rather than failing the
// whole batch. Falls back to small fixed offsets when duration is unknown
// (<= 0).
func pickFrameTimestamps(durationSeconds float64, lowPercent, highPercent float64, n int, exclude []float64) []float64 {
	out := make([]float64, n)
	if durationSeconds <= 0 {
		for i := range out {
			out[i] = float64(i + 1)
		}
		return out
	}

	lo := durationSeconds * (lowPercent / 100)
	hi := durationSeconds * (highPercent / 100)
	if grace := durationSeconds - endOfVideoGraceSeconds; hi > grace {
		hi = grace
	}
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
// item's original URL and replaces the current one — reuses the same
// YtDlpService.FetchThumbnail already used by Import, but yt-dlp runs in a
// unique scratch directory (never next to the media file), and only the
// resulting jpg's bytes go through the safe replace, so a failed fetch or
// write leaves the current thumbnail exactly as it was. Ghost items (no file)
// take the fetchGhostThumbnail route instead: resized tiers only.
func RedownloadLibraryThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, responder *ItemResponder, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, locks *itemlock.Locks) gin.HandlerFunc {
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
			writeServerError(c, err)
			return
		}
		if item.Path != "" && rejectImageItem(c, item) {
			return
		}
		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}
		if item.Path == "" {
			// Ghost: no media file, so no sidecar location. Store the same
			// resized WebP tiers ghost creation does (plain Thumbnail stays null).
			if !fetchGhostThumbnail(ctx, libraryRepo, imagesRoot, ytdlp, id, *item.OriginalURL) {
				c.JSON(http.StatusBadGateway, gin.H{"error": "fetching thumbnail: could not fetch or process the image from the source URL"})
				return
			}
			// The new tiers make any AI-enhancement backup stale (a ghost can be
			// a former real item that was enhanced before its file was deleted).
			if err := thumbnailenhance.DeleteOriginal(ctx, thumbnailenhance.Deps{OriginalsRepo: originalsRepo, ImagesRoot: imagesRoot}, id); err != nil && !errors.Is(err, repository.ErrNotFound) {
				log.Printf("library thumbnail: clearing stale AI-enhancement backup for item %d failed: %v", id, err)
			}
			updated, err := libraryRepo.Get(ctx, id)
			if err != nil {
				writeServerError(c, err)
				return
			}
			resp, err := responder.Response(ctx, *updated)
			if err != nil {
				writeServerError(c, err)
				return
			}
			c.JSON(http.StatusOK, resp)
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		if pathIsMedia(mediaRoot, item, thumbnailAbsPathFor(mediaAbs)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
			return
		}
		thumbAbs := thumbnailAbsPathFor(mediaAbs)

		// yt-dlp (and its converters) run in a scratch directory of their own
		// and may leave intermediate files; the whole directory goes away on
		// every path, so nothing from yt-dlp can remain next to the media file.
		data, err := fetchThumbnailBytes(ctx, ytdlp, mediaRoot, *item.OriginalURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching thumbnail: " + err.Error()})
			return
		}

		writeThumbnailAndRespond(c, thumbnailCommit{libraryRepo, responder, originalsRepo, locks, mediaRoot, imagesRoot, ytdlp.FFmpegPath}, id, item.Path, thumbAbs, data, false)
	}
}

// fetchThumbnailBytes runs yt-dlp's thumbnail fetch for url inside a fresh
// scratch directory under the downloader's scratch area (.packrat-tmp, same
// volume as the media root) and returns the jpg's bytes. The directory is
// removed before returning, on success and on every error.
func fetchThumbnailBytes(ctx context.Context, ytdlp *downloader.YtDlpService, mediaRoot, url string) ([]byte, error) {
	tmpRoot := downloader.TrimTmpDir(mediaRoot)
	if err := os.MkdirAll(tmpRoot, 0o755); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(tmpRoot, "thumb-")
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			log.Printf("library thumbnail: removing scratch directory %s failed: %v", dir, err)
		}
	}()
	jpg, err := ytdlp.FetchThumbnail(ctx, url, dir, "thumbnail")
	if err != nil {
		return nil, err
	}
	return os.ReadFile(jpg)
}

// QuickGrabLibraryThumbnail extracts one frame from the video file at a
// random timestamp and immediately makes it the thumbnail.
func QuickGrabLibraryThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, settingsRepo *repository.SettingsRepo, responder *ItemResponder, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, locks *itemlock.Locks) gin.HandlerFunc {
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
			writeServerError(c, err)
			return
		}

		if rejectImageItem(c, item) {
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
		rangeLow, err := ThumbnailFrameRangeLow(ctx, settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		rangeHigh, err := ThumbnailFrameRangeHigh(ctx, settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ts := pickFrameTimestamps(duration, float64(rangeLow), float64(rangeHigh), 1, nil)[0]

		frame, err := ytdlp.ExtractFrame(ctx, mediaAbs, ts)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "grabbing frame: " + err.Error()})
			return
		}

		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if pathIsMedia(mediaRoot, item, thumbAbs) {
			c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
			return
		}

		writeThumbnailAndRespond(c, thumbnailCommit{libraryRepo, responder, originalsRepo, locks, mediaRoot, imagesRoot, ytdlp.FFmpegPath}, id, item.Path, thumbAbs, frame, false)
	}
}

// maxThumbnailCandidateFrames caps both the "count" a caller may request from
// GET .../thumbnail/timestamps and how many explicit timestamps one
// GET .../thumbnail/candidates call will extract.
const maxThumbnailCandidateFrames = 50

// intQueryParam reads an optional integer query param, returning fallback
// when it's absent.
func intQueryParam(c *gin.Context, name string, fallback int) (int, error) {
	raw := c.Query(name)
	if raw == "" {
		return fallback, nil
	}
	return strconv.Atoi(raw)
}

// floatQueryParam is intQueryParam for decimal values — the per-call pick
// range may be fractional (a time-based range converted to percent).
func floatQueryParam(c *gin.Context, name string, fallback float64) (float64, error) {
	raw := c.Query(name)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, errors.New("not a finite number")
	}
	return v, nil
}

// validateFramePick checks a per-call frame count and pick range (percent of
// duration) against the same bounds the Settings page enforces.
func validateFramePick(count int, low, high float64) error {
	if count < 1 || count > maxThumbnailCandidateFrames {
		return fmt.Errorf("count must be between 1 and %d", maxThumbnailCandidateFrames)
	}
	if low < 0 || high > 100 || low >= high {
		return errors.New("range must satisfy 0 <= low < high <= 100")
	}
	return nil
}

// GetLibraryThumbnailTimestamps picks the timestamps for a "choose from
// video" batch without extracting anything — the first half of the
// client-driven flow: the frontend then fetches the frames one at a time via
// GET .../thumbnail/candidates?timestamps=, so it can show real progress.
// "count", "low" and "high" (percent of duration) override the matching
// settings for this call only; "exclude" is the same comma-separated list of
// already-seen timestamps the candidates endpoint takes.
func GetLibraryThumbnailTimestamps(mediaRoot string, libraryRepo *repository.LibraryRepo, ffprobePath string, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
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
			writeServerError(c, err)
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		count, err := ThumbnailFrameCount(ctx, settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		settingLow, err := ThumbnailFrameRangeLow(ctx, settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		settingHigh, err := ThumbnailFrameRangeHigh(ctx, settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}

		if count, err = intQueryParam(c, "count", count); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid count"})
			return
		}
		rangeLow, err := floatQueryParam(c, "low", float64(settingLow))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid low"})
			return
		}
		rangeHigh, err := floatQueryParam(c, "high", float64(settingHigh))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid high"})
			return
		}
		if err := validateFramePick(count, rangeLow, rangeHigh); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
		timestamps := pickFrameTimestamps(duration, rangeLow, rangeHigh, count, exclude)
		c.JSON(http.StatusOK, gin.H{"timestamps": timestamps})
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
			writeServerError(c, err)
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
			if len(timestamps) > maxThumbnailCandidateFrames {
				c.JSON(http.StatusBadRequest, gin.H{"error": "too many timestamps (max " + strconv.Itoa(maxThumbnailCandidateFrames) + ")"})
				return
			}
		} else {
			frameCount, err := ThumbnailFrameCount(ctx, settingsRepo)
			if err != nil {
				writeServerError(c, err)
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
			rangeLow, err := ThumbnailFrameRangeLow(ctx, settingsRepo)
			if err != nil {
				writeServerError(c, err)
				return
			}
			rangeHigh, err := ThumbnailFrameRangeHigh(ctx, settingsRepo)
			if err != nil {
				writeServerError(c, err)
				return
			}
			duration := resolveDuration(ctx, item.Duration, mediaAbs, ffprobePath)
			timestamps = pickFrameTimestamps(duration, float64(rangeLow), float64(rangeHigh), frameCount, exclude)
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
func SetLibraryThumbnail(mediaRoot, imagesRoot, ffmpegPath string, libraryRepo *repository.LibraryRepo, responder *ItemResponder, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, locks *itemlock.Locks) gin.HandlerFunc {
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
			writeServerError(c, err)
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

		if isImageItem(item) {
			setImageItemThumbnailTiers(c, libraryRepo, responder, originalsRepo, item, imagesRoot, ffmpegPath, data)
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if pathIsMedia(mediaRoot, item, thumbAbs) {
			c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
			return
		}

		// The bytes come from the client: undecodable data is a 400.
		writeThumbnailAndRespond(c, thumbnailCommit{libraryRepo, responder, originalsRepo, locks, mediaRoot, imagesRoot, ffmpegPath}, id, item.Path, thumbAbs, data, true)
	}
}

// DeleteLibraryItemThumbnail removes an item's thumbnail — the raw sidecar
// file (if any — a ghost's fetched thumbnail has no MediaRoot-relative
// Thumbnail, only the ImagesRoot derivatives, see fetchGhostThumbnail) and
// both small/medium derivatives plus any AI-enhancement original — leaving the media file, filename/path,
// and status untouched. The item falls back to MediaTypePlaceholder
// everywhere a thumbnail would've shown.
func DeleteLibraryItemThumbnail(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo) gin.HandlerFunc {
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
			writeServerError(c, err)
			return
		}
		if rejectImageItem(c, item) {
			return
		}
		if item.Thumbnail == nil && item.ThumbnailSmallPath == nil && item.ThumbnailMediumPath == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no thumbnail"})
			return
		}

		if item.Thumbnail != nil {
			abs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			if pathIsMedia(mediaRoot, item, abs) {
				c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
				return
			}
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
			writeServerError(c, err)
			return
		}
		// The enhanced image was the thumbnail itself; with it gone the
		// backup has nothing left to compare against or revert onto.
		removeEnhancementOriginal(ctx, originalsRepo, imagesRoot, id)
		c.Status(http.StatusNoContent)
	}
}

// thumbnailCommit bundles what the thumbnail-replacing handlers share.
type thumbnailCommit struct {
	libraryRepo   *repository.LibraryRepo
	responder     *ItemResponder
	originalsRepo *repository.ThumbnailEnhancementOriginalsRepo
	locks         *itemlock.Locks
	mediaRoot     string
	imagesRoot    string
	ffmpegPath    string
}

// errThumbnailBusy means another file-changing request holds the item.
var errThumbnailBusy = errors.New(itemBusyMessage)

// replaceThumbnail swaps data in as the item's sidecar thumbnail under the
// item lock (the sidecar is a companion file of the media file, which a
// concurrent rename/move relocates). Only the swap is locked — callers fetch
// or extract the image before. mediaPath is the item's path as the caller saw
// it; if it changed by the time the lock is held, the item is busy.
func (tc thumbnailCommit) replaceThumbnail(ctx context.Context, id int64, mediaPath, thumbAbs string, data []byte) error {
	if !tc.locks.TryLock(id) {
		return errThumbnailBusy
	}
	defer tc.locks.Unlock(id)

	current, err := tc.libraryRepo.Get(ctx, id)
	if err != nil {
		return err
	}
	if current.Path != mediaPath {
		return errThumbnailBusy
	}

	thumbRel := toRelSlash(tc.mediaRoot, thumbAbs)
	_, err = thumbwrite.Replace(ctx, thumbwrite.Params{
		Repo:       tc.libraryRepo,
		FFmpegPath: tc.ffmpegPath,
		ImagesRoot: tc.imagesRoot,
		ID:         id,
		ThumbAbs:   thumbAbs,
		ThumbRel:   &thumbRel,
		Data:       data,
	})
	return err
}

// writeThumbnailAndRespond replaces the sidecar with data (see
// thumbwrite.Replace for the order and the failure guarantee) and answers
// with the updated item. Order here: (a) item lock, (b) safe replace, (c) only
// after success clear the now-stale AI-enhancement backup, (d) respond. On any
// failure nothing was changed and the AI backup is untouched. It reports
// whether the 200 response was sent.
//
// Failures: busy item 409; with clientData, undecodable data 400; otherwise 500
// with the error message.
func writeThumbnailAndRespond(c *gin.Context, tc thumbnailCommit, id int64, mediaPath, thumbAbs string, data []byte, clientData bool) bool {
	ctx := c.Request.Context()

	if err := tc.replaceThumbnail(ctx, id, mediaPath, thumbAbs, data); err != nil {
		switch {
		case errors.Is(err, errThumbnailBusy):
			writeItemBusy(c)
		case clientData && errors.Is(err, thumbwrite.ErrNotAnImage):
			c.JSON(http.StatusBadRequest, gin.H{"error": "the data is not a decodable image"})
		case errors.Is(err, repository.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
		default:
			writeServerError(c, err)
		}
		return false
	}

	// The new image makes any AI-enhancement backup stale — its "before" is
	// unrelated to this thumbnail. Clear it so Compare/Revert don't act on
	// stale data (best-effort; ErrNotFound just means this item was never enhanced).
	if err := thumbnailenhance.DeleteOriginal(ctx, thumbnailenhance.Deps{OriginalsRepo: tc.originalsRepo, ImagesRoot: tc.imagesRoot}, id); err != nil && !errors.Is(err, repository.ErrNotFound) {
		log.Printf("library thumbnail: clearing stale AI-enhancement backup for item %d failed: %v", id, err)
	}

	updated, err := tc.libraryRepo.Get(ctx, id)
	if err != nil {
		writeServerError(c, err)
		return false
	}
	resp, err := tc.responder.Response(ctx, *updated)
	if err != nil {
		writeServerError(c, err)
		return false
	}
	c.JSON(http.StatusOK, resp)
	return true
}
