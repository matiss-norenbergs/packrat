package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/framematch"
	"packrat/backend/internal/repository"
)

// StartFrameMatch kicks off a background scan of the item's video for the
// frame that best matches either its source-URL thumbnail or its current
// one (see StartFrameMatchRequest.Mode), returning a job ID to poll via
// GetFrameMatchStatus — matching routinely takes tens of seconds to a
// couple of minutes, far too long to hold this request open.
//
// Mode "url" deliberately does not reuse YtDlpService.FetchThumbnail: that
// helper runs yt-dlp's --convert-thumbnails postprocessor, the exact
// pipeline already known to fail silently-ish on formats like AVIF (see
// queue/manager.go's exit-code leniency comment). FetchThumbnailRaw fetches
// the source format untouched, and DecodeImageToJPEG converts it as an
// explicit step this handler controls — a real decode failure comes back
// as a real error instead of a missing file.
func StartFrameMatch(mediaRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, jobs *framematch.JobStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req StartFrameMatchRequest
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
		videoAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

		var referenceJPEG []byte
		switch req.Mode {
		case "current":
			if item.Thumbnail == nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "item has no thumbnail to compare against"})
				return
			}
			// Despite the .jpg extension this file isn't reliably real JPEG
			// bytes — AI Enhancement (internal/thumbnailenhance) writes its
			// upscaler output to this same path without re-encoding, and
			// that output can be PNG. Route through the same ffmpeg decode
			// used for mode "url" instead of assuming the format.
			thumbAbs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			data, err := downloader.DecodeImageToJPEG(ctx, ytdlp.FFmpegPath, thumbAbs)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "reading current thumbnail: " + err.Error()})
				return
			}
			referenceJPEG = data

		case "url":
			if item.OriginalURL == nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
				return
			}
			rawPath, err := ytdlp.FetchThumbnailRaw(ctx, *item.OriginalURL, os.TempDir(), "framematch-ref-"+uuid.NewString())
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "fetching source thumbnail: " + err.Error()})
				return
			}
			defer os.Remove(rawPath)
			referenceJPEG, err = downloader.DecodeImageToJPEG(ctx, ytdlp.FFmpegPath, rawPath)
			if err != nil {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "decoding source thumbnail: " + err.Error()})
				return
			}
		}

		jobID := jobs.Start(ytdlp, ffprobePath, videoAbs, referenceJPEG)
		c.JSON(http.StatusOK, StartFrameMatchResponse{JobID: jobID})
	}
}

// GetFrameMatchStatus polls a job started by StartFrameMatch.
func GetFrameMatchStatus(jobs *framematch.JobStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, ok := jobs.Get(c.Param("jobId"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "match job not found"})
			return
		}

		resp := FrameMatchStatusResponse{State: status.State}
		switch status.State {
		case "done":
			ts := status.Result.TimestampSeconds
			score := status.Result.Score
			img := status.Result.ImageBase64
			ref := status.Result.ReferenceImageBase64
			resp.TimestampSeconds = &ts
			resp.Score = &score
			resp.ImageBase64 = &img
			resp.ReferenceImageBase64 = &ref
		case "error":
			errMsg := status.ErrorMsg
			resp.Error = &errMsg
		}
		c.JSON(http.StatusOK, resp)
	}
}
