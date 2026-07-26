// Package imagebackfill runs the multi-size-image backfill — generating
// small/medium/original WebP derivatives for every library thumbnail,
// artist image, and collection cover that predates that feature (or that
// lost its derivatives to a reset ImagesRoot) — as a background job the
// Settings page can trigger and poll. This is the in-app replacement for
// the original one-off cmd/backfill-images CLI tool: same three passes,
// same idempotency (each pass only touches rows/files not already on the
// new convention), just triggered from the UI and run in a goroutine
// instead of a throwaway binary.
package imagebackfill

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/repository"
)

var libraryThumbnailTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

var artistImageTiers = []imageproc.Tier{{Name: "image", MaxWidth: imageproc.ArtistImageWidth}}

var coverImageTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
	{Name: "original", MaxWidth: imageproc.CoverOriginalWidth},
}

// Status is a snapshot of the backfill job's progress — safe to copy and
// serialize, never mutated after being handed out by Manager.
type Status struct {
	Running    bool       `json:"running"`
	StartedAt  *time.Time `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`

	LibraryProcessed int `json:"libraryProcessed"`
	LibraryFailed    int `json:"libraryFailed"`
	ArtistProcessed  int `json:"artistProcessed"`
	ArtistFailed     int `json:"artistFailed"`
	CoverProcessed   int `json:"coverProcessed"`
	CoverFailed      int `json:"coverFailed"`
}

// Manager runs the backfill and tracks its progress. One instance lives for
// the lifetime of the server (see cmd/server/main.go) so its in-memory
// status survives across requests.
type Manager struct {
	mediaRoot, imagesRoot, ffmpegPath string
	libraryRepo                       *repository.LibraryRepo
	artistsRepo                       *repository.ArtistsRepo
	collectionsRepo                   *repository.CollectionsRepo

	mu     sync.Mutex
	status Status
}

func NewManager(mediaRoot, imagesRoot, ffmpegPath string, libraryRepo *repository.LibraryRepo, artistsRepo *repository.ArtistsRepo, collectionsRepo *repository.CollectionsRepo) *Manager {
	return &Manager{
		mediaRoot:       mediaRoot,
		imagesRoot:      imagesRoot,
		ffmpegPath:      ffmpegPath,
		libraryRepo:     libraryRepo,
		artistsRepo:     artistsRepo,
		collectionsRepo: collectionsRepo,
	}
}

// Status returns a snapshot of the current (or most recent) run.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

// Start kicks off a backfill run in the background unless one is already in
// progress, in which case it's a no-op — callers should treat "already
// running" as success too (just keep polling Status), not an error.
func (m *Manager) Start() {
	m.mu.Lock()
	if m.status.Running {
		m.mu.Unlock()
		return
	}
	now := time.Now()
	m.status = Status{Running: true, StartedAt: &now}
	m.mu.Unlock()

	go m.run()
}

func (m *Manager) run() {
	ctx := context.Background()

	libProcessed, libFailed := m.backfillLibraryThumbnails(ctx)
	m.mu.Lock()
	m.status.LibraryProcessed = libProcessed
	m.status.LibraryFailed = libFailed
	m.mu.Unlock()

	artProcessed, artFailed := m.backfillArtistImages(ctx)
	m.mu.Lock()
	m.status.ArtistProcessed = artProcessed
	m.status.ArtistFailed = artFailed
	m.mu.Unlock()

	covProcessed, covFailed := m.backfillCollectionCovers(ctx)
	m.mu.Lock()
	m.status.CoverProcessed = covProcessed
	m.status.CoverFailed = covFailed
	finished := time.Now()
	m.status.FinishedAt = &finished
	m.status.Running = false
	m.mu.Unlock()

	log.Printf("image backfill: done — library %d processed/%d failed, artists %d/%d failed, covers %d/%d failed",
		libProcessed, libFailed, artProcessed, artFailed, covProcessed, covFailed)
}

// backfillLibraryThumbnails generates small/medium derivatives for every
// item that has an original thumbnail but no small-tier derivative yet.
func (m *Manager) backfillLibraryThumbnails(ctx context.Context) (processed, failed int) {
	items, _, err := m.libraryRepo.Query(ctx, repository.LibraryQuery{})
	if err != nil {
		log.Printf("image backfill: listing library items failed: %v", err)
		return 0, 0
	}
	for _, item := range items {
		if item.Thumbnail == nil || item.ThumbnailSmallPath != nil {
			continue
		}
		thumbAbs := filepath.Join(m.mediaRoot, filepath.FromSlash(*item.Thumbnail))
		tiers, err := imageproc.GenerateTiersFromPath(ctx, m.ffmpegPath, m.imagesRoot, "library", item.ID, thumbAbs, libraryThumbnailTiers)
		if err != nil {
			log.Printf("image backfill: library item %d: generating derivatives: %v", item.ID, err)
			failed++
			continue
		}
		if err := m.libraryRepo.UpdateThumbnailTiers(ctx, item.ID, &tiers[0], &tiers[1]); err != nil {
			log.Printf("image backfill: library item %d: saving derivative paths: %v", item.ID, err)
			failed++
			continue
		}
		processed++
	}
	return processed, failed
}

// backfillArtistImages re-encodes every gallery image not yet on the
// single-tier WebP convention (detected by path shape — pre-migration files
// live directly under artists/<id>/<uuid>.<ext>, the new convention always
// adds an "image" tier folder) and repoints the artist's selection if it
// was pointing at the file just replaced.
func (m *Manager) backfillArtistImages(ctx context.Context) (processed, failed int) {
	artists, err := m.artistsRepo.List(ctx)
	if err != nil {
		log.Printf("image backfill: listing artists failed: %v", err)
		return 0, 0
	}
	for _, artist := range artists {
		images, err := m.artistsRepo.ListImages(ctx, artist.ID)
		if err != nil {
			log.Printf("image backfill: artist %d: listing images failed: %v", artist.ID, err)
			continue
		}
		for _, img := range images {
			if strings.Contains(filepath.ToSlash(img.RelativePath), "/image/") {
				continue // already on the new convention
			}
			oldAbs := filepath.Join(m.imagesRoot, filepath.FromSlash(img.RelativePath))
			tiers, err := imageproc.GenerateTiersFromPath(ctx, m.ffmpegPath, m.imagesRoot, "artists", artist.ID, oldAbs, artistImageTiers)
			if err != nil {
				log.Printf("image backfill: artist image %d: generating derivative: %v", img.ID, err)
				failed++
				continue
			}
			newPath := tiers[0]
			if err := m.artistsRepo.UpdateImagePath(ctx, img.ID, newPath); err != nil {
				log.Printf("image backfill: artist image %d: saving path: %v", img.ID, err)
				failed++
				continue
			}
			if artist.SelectedImagePath != nil && *artist.SelectedImagePath == img.RelativePath {
				if err := m.artistsRepo.SetSelectedImage(ctx, artist.ID, &newPath); err != nil {
					log.Printf("image backfill: artist %d: updating selected image: %v", artist.ID, err)
				}
			}
			if err := os.Remove(oldAbs); err != nil && !os.IsNotExist(err) {
				log.Printf("image backfill: artist image %d: deleting old file %s: %v", img.ID, oldAbs, err)
			}
			processed++
		}
	}
	return processed, failed
}

// backfillCollectionCovers expands every collection's single stored cover
// file into the small/medium/original tiers.
func (m *Manager) backfillCollectionCovers(ctx context.Context) (processed, failed int) {
	cols, err := m.collectionsRepo.List(ctx)
	if err != nil {
		log.Printf("image backfill: listing collections failed: %v", err)
		return 0, 0
	}
	for _, c := range cols {
		if c.CoverImagePath == nil || c.CoverImageSmallPath != nil {
			continue
		}
		oldAbs := filepath.Join(m.imagesRoot, filepath.FromSlash(*c.CoverImagePath))
		tiers, err := imageproc.GenerateTiersFromPath(ctx, m.ffmpegPath, m.imagesRoot, "collections", c.ID, oldAbs, coverImageTiers)
		if err != nil {
			log.Printf("image backfill: collection %d: generating derivatives: %v", c.ID, err)
			failed++
			continue
		}
		small, medium, original := tiers[0], tiers[1], tiers[2]
		if err := m.collectionsRepo.SetCoverImageTiers(ctx, c.ID, &small, &medium, &original); err != nil {
			log.Printf("image backfill: collection %d: saving derivative paths: %v", c.ID, err)
			failed++
			continue
		}
		if err := os.Remove(oldAbs); err != nil && !os.IsNotExist(err) {
			log.Printf("image backfill: collection %d: deleting old cover file %s: %v", c.ID, oldAbs, err)
		}
		processed++
	}
	return processed, failed
}
