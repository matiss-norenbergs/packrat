package backup

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type testRepos struct {
	collections *repository.CollectionsRepo
	tags        *repository.TagsRepo
	artists     *repository.ArtistsRepo
	library     *repository.LibraryRepo
	downloads   *repository.DownloadsRepo
	settings    *repository.SettingsRepo
}

func openTestRepos(t *testing.T) testRepos {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "packrat_test.db")
	conn, err := db.Open(dbPath)
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}

	return testRepos{
		collections: repository.NewCollectionsRepo(conn),
		tags:        repository.NewTagsRepo(conn),
		artists:     repository.NewArtistsRepo(conn),
		library:     repository.NewLibraryRepo(conn),
		downloads:   repository.NewDownloadsRepo(conn),
		settings:    repository.NewSettingsRepo(conn),
	}
}

func TestBuildApplyLibraryBundle_RoundTrip(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)

	artist, err := repos.artists.Create(ctx, "Test Artist")
	if err != nil {
		t.Fatalf("creating artist: %v", err)
	}
	season := 2
	musicID, err := repos.collections.Create(ctx, &models.Collection{
		Name: "Music", RootPath: "Music", DefaultQuality: "best", DefaultDownloadType: "audio",
		SeasonNumber: &season, ArtistID: &artist.ID,
	})
	if err != nil {
		t.Fatalf("creating collection: %v", err)
	}
	tag, err := repos.tags.Create(ctx, "test-tag", true)
	if err != nil {
		t.Fatalf("creating tag: %v", err)
	}

	dlID, err := repos.downloads.Create(ctx, &models.Download{
		URL: "https://example.com/song", DownloadType: "audio", Quality: "best", Status: models.StatusCompleted,
	})
	if err != nil {
		t.Fatalf("creating download: %v", err)
	}

	url := "https://example.com/song"
	withURLID, err := repos.library.Create(ctx, &models.LibraryItem{
		DownloadID: &dlID, Title: "Song", Filename: "song.mp3", Path: "Music/song.mp3",
		CollectionID: &musicID, OriginalURL: &url, ArtistID: &artist.ID, Status: "completed",
	})
	if err != nil {
		t.Fatalf("creating library item with URL: %v", err)
	}
	if err := repos.tags.SetForLibraryItem(ctx, withURLID, []int64{tag.ID}); err != nil {
		t.Fatalf("setting tags: %v", err)
	}

	// A second item with no originalUrl must be excluded from the export —
	// there'd be nothing to redownload it from.
	if _, err := repos.library.Create(ctx, &models.LibraryItem{
		Title: "No URL", Filename: "nourl.mp3", Path: "nourl.mp3", Status: "completed",
	}); err != nil {
		t.Fatalf("creating library item without URL: %v", err)
	}

	bundle, err := BuildLibraryBundle(ctx, repos.collections, repos.tags, repos.artists, repos.library, repos.downloads)
	if err != nil {
		t.Fatalf("BuildLibraryBundle: %v", err)
	}
	if len(bundle.LibraryItems) != 1 {
		t.Fatalf("expected exactly 1 exported library item (URL-having only), got %d", len(bundle.LibraryItems))
	}
	item := bundle.LibraryItems[0]
	if item.OriginalURL != url || item.ArtistName != "Test Artist" || len(item.CollectionPath) != 1 || item.CollectionPath[0] != "Music" {
		t.Fatalf("unexpected exported item: %+v", item)
	}
	if item.DownloadType != "audio" || item.Quality != "best" {
		t.Fatalf("expected quality/type carried over from the Download row, got %+v", item)
	}
	if len(item.Tags) != 1 || item.Tags[0] != "test-tag" {
		t.Fatalf("expected tags to be exported, got %+v", item.Tags)
	}
	if len(bundle.Collections) != 1 || bundle.Collections[0].SeasonNumber == nil || *bundle.Collections[0].SeasonNumber != season {
		t.Fatalf("expected the collection's season number to be exported, got %+v", bundle.Collections)
	}
	if bundle.Collections[0].ArtistName != "Test Artist" {
		t.Fatalf("expected the collection's artist name to be exported, got %+v", bundle.Collections[0])
	}
	if len(bundle.Tags) != 1 || bundle.Tags[0].Name != "test-tag" || !bundle.Tags[0].IsPrivate {
		t.Fatalf("expected the tag's privacy flag to be exported, got %+v", bundle.Tags)
	}

	// Applying the very same bundle back against the SAME database must not
	// create duplicate collections/tags/artists — everything should already
	// match by name/path.
	resolved, result, err := ApplyLibraryBundle(ctx, repos.collections, repos.tags, repos.artists, bundle)
	if err != nil {
		t.Fatalf("ApplyLibraryBundle: %v", err)
	}
	if result.CollectionsEnsured != 1 || result.TagsCreated != 0 || result.ArtistsCreated != 0 {
		t.Fatalf("expected a no-op merge (nothing new), got %+v", result)
	}
	if len(resolved) != 1 {
		t.Fatalf("expected exactly 1 resolved download, got %d", len(resolved))
	}
	r := resolved[0]
	if r.URL != url || r.CollectionID == nil || *r.CollectionID != musicID || r.ArtistID == nil || *r.ArtistID != artist.ID {
		t.Fatalf("expected resolved download to match existing collection/artist ids, got %+v", r)
	}
	if len(r.Tags) != 1 || r.Tags[0] != "test-tag" {
		t.Fatalf("expected the resolved download to carry the item's tags for reassignment on redownload, got %+v", r.Tags)
	}

	// Applying into a FRESH database must create everything from scratch.
	fresh := openTestRepos(t)
	resolved2, result2, err := ApplyLibraryBundle(ctx, fresh.collections, fresh.tags, fresh.artists, bundle)
	if err != nil {
		t.Fatalf("ApplyLibraryBundle (fresh db): %v", err)
	}
	if result2.CollectionsEnsured != 1 || result2.TagsCreated != 1 || result2.ArtistsCreated != 1 {
		t.Fatalf("expected everything freshly created, got %+v", result2)
	}
	if len(resolved2) != 1 || resolved2[0].CollectionID == nil || resolved2[0].ArtistID == nil {
		t.Fatalf("expected the resolved download to reference newly created ids, got %+v", resolved2)
	}
	if len(resolved2[0].Tags) != 1 || resolved2[0].Tags[0] != "test-tag" {
		t.Fatalf("expected the resolved download to carry tags even into a fresh db, got %+v", resolved2[0].Tags)
	}
	freshCol, err := fresh.collections.Get(ctx, *resolved2[0].CollectionID)
	if err != nil {
		t.Fatalf("fetching freshly imported collection: %v", err)
	}
	if freshCol.SeasonNumber == nil || *freshCol.SeasonNumber != season {
		t.Fatalf("expected the imported collection to carry the season number, got %+v", freshCol.SeasonNumber)
	}
	if freshCol.ArtistID == nil || *freshCol.ArtistID != *resolved2[0].ArtistID {
		t.Fatalf("expected the imported collection to carry the artist id, got %+v", freshCol.ArtistID)
	}
	freshTags, err := fresh.tags.List(ctx)
	if err != nil {
		t.Fatalf("listing freshly imported tags: %v", err)
	}
	if len(freshTags) != 1 || !freshTags[0].IsPrivate {
		t.Fatalf("expected the imported tag to be private, got %+v", freshTags)
	}
}

func TestApplyLibraryBundle_InfersAudioTypeFromMissingDownloadType(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)

	// Simulates an item whose originating Download row was already gone at
	// export time — DownloadType/Quality/AudioFormat are absent, same as
	// BuildLibraryBundle would produce, but the filename still reveals it
	// was an audio download. Without inferring from it, this used to
	// silently fall back to a video type that conflicts with the .mp3
	// filename and makes yt-dlp fail outright.
	bundle := LibraryBundle{
		LibraryItems: []LibraryItemEntry{
			{OriginalURL: "https://example.com/song", Filename: "Song.mp3"},
			{OriginalURL: "https://example.com/clip", Filename: "Clip.mp4"},
		},
	}

	resolved, _, err := ApplyLibraryBundle(ctx, repos.collections, repos.tags, repos.artists, bundle)
	if err != nil {
		t.Fatalf("ApplyLibraryBundle: %v", err)
	}
	if len(resolved) != 2 {
		t.Fatalf("expected 2 resolved downloads, got %d", len(resolved))
	}

	mp3 := resolved[0]
	if mp3.DownloadType != "audio" || mp3.AudioFormat != "mp3" {
		t.Fatalf("expected the .mp3 item to infer audio/mp3, got type=%q format=%q", mp3.DownloadType, mp3.AudioFormat)
	}

	mp4 := resolved[1]
	if mp4.DownloadType != "" {
		t.Fatalf("expected the .mp4 item to leave DownloadType empty (caller's video default applies), got %q", mp4.DownloadType)
	}
}

func TestBuildApplySettingsBundle_RoundTrip(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)

	if err := repos.settings.Set(ctx, "max_concurrent_downloads", "3"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	bundle, err := BuildSettingsBundle(ctx, repos.settings)
	if err != nil {
		t.Fatalf("BuildSettingsBundle: %v", err)
	}
	if bundle["max_concurrent_downloads"] != "3" {
		t.Fatalf("expected exported setting to be %q, got %+v", "3", bundle)
	}

	if err := repos.settings.Set(ctx, "max_concurrent_downloads", "1"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	applied, err := ApplySettingsBundle(ctx, repos.settings, bundle)
	if err != nil {
		t.Fatalf("ApplySettingsBundle: %v", err)
	}
	if applied != len(bundle) {
		t.Fatalf("expected %d applied, got %d", len(bundle), applied)
	}

	got, err := repos.settings.Get(ctx, "max_concurrent_downloads")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "3" {
		t.Fatalf("expected imported value to restore %q, got %q", "3", got)
	}
}
