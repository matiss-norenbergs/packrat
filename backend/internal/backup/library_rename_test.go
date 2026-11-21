package backup

// What a library bundle restore does after a collection's FOLDER name
// (root_path) was renamed between the export and the restore.
//
// A bundle refers to collections by the chain of folder names from the media
// root (CollectionEntry.Path / LibraryItemEntry.CollectionPath). Renaming a
// collection's folder moves nothing on disk (docs/FEATURES.md, Collections), so
// the bundle and the live library can disagree about the name of a folder. The
// restore (chainResolver) therefore matches a level by folder name first, then
// by the entry's display name, and only then creates a collection; an existing
// collection is never modified, a created one takes the entry's settings. These
// tests run the real entry points: BuildLibraryBundle -> (JSON, like the file the
// API writes) -> PreviewLibraryBundle / ApplyLibraryBundle. They started as the
// investigation that documented the old (duplicating / silent) behavior.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// renameScene is a small library with the four collection shapes that matter:
//
//	Shows (name "Shows", folder "Shows")
//	  └─ Anime (name "Anime", folder "Anime", 720p)
//	Concerts (name "Concerts", folder "concerts", private, 1080p, Jellyfin library) — display name != folder
//	Podcasts (name "Podcasts", folder "Podcasts")                                    — display name == folder
//
// each holding one downloaded item that has a saved URL.
type renameScene struct {
	repos                            testRepos
	shows, anime, concerts, podcasts int64
}

func seedRenameScene(t *testing.T) *renameScene {
	t.Helper()
	ctx := context.Background()
	s := &renameScene{repos: openTestRepos(t)}
	jf := "jf-1"
	mk := func(c models.Collection) int64 {
		t.Helper()
		id, err := s.repos.collections.Create(ctx, &c)
		if err != nil {
			t.Fatalf("creating collection %q: %v", c.Name, err)
		}
		return id
	}
	s.shows = mk(models.Collection{Name: "Shows", RootPath: "Shows", DefaultQuality: "best", DefaultDownloadType: "video"})
	s.anime = mk(models.Collection{Name: "Anime", RootPath: "Anime", ParentID: &s.shows, DefaultQuality: "720p", DefaultDownloadType: "video"})
	s.concerts = mk(models.Collection{Name: "Concerts", RootPath: "concerts", DefaultQuality: "1080p", DefaultDownloadType: "video", IsPrivate: true, JellyfinLibrary: &jf})
	s.podcasts = mk(models.Collection{Name: "Podcasts", RootPath: "Podcasts", DefaultQuality: "best", DefaultDownloadType: "audio"})

	item := func(title, file, dir string, col int64) {
		t.Helper()
		url := "https://example.com/" + file
		if _, err := s.repos.library.Create(ctx, &models.LibraryItem{
			Title: title, Filename: file + ".mp4", Path: dir + "/" + file + ".mp4",
			CollectionID: &col, OriginalURL: &url, Status: "completed",
		}); err != nil {
			t.Fatalf("creating item %q: %v", title, err)
		}
	}
	item("Gig", "gig", "concerts", s.concerts)
	item("Ep1", "ep1", "Shows/Anime", s.anime)
	item("Pod1", "pod1", "Podcasts", s.podcasts)
	return s
}

// export builds the bundle the way POST /api/backup/export/library does and
// passes it through JSON, so the restore sees exactly what a file would carry.
func (s *renameScene) export(t *testing.T) LibraryBundle {
	t.Helper()
	return exportBundle(t, s.repos)
}

func exportBundle(t *testing.T, repos testRepos) LibraryBundle {
	t.Helper()
	b, err := BuildLibraryBundle(context.Background(), repos.collections, repos.tags, repos.artists, repos.library, repos.downloads)
	if err != nil {
		t.Fatalf("BuildLibraryBundle: %v", err)
	}
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatalf("marshaling bundle: %v", err)
	}
	var out LibraryBundle
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshaling bundle: %v", err)
	}
	return out
}

func restoreBundle(t *testing.T, repos testRepos, b LibraryBundle, ghostOnly bool) ([]ResolvedDownload, ApplyResult) {
	t.Helper()
	resolved, result, err := ApplyLibraryBundle(context.Background(), repos.db, repos.collections, repos.tags, repos.artists, repos.library, b, ghostOnly)
	if err != nil {
		t.Fatalf("ApplyLibraryBundle: %v", err)
	}
	return resolved, result
}

// setFolder changes only a collection's folder name, like editing "Folder name"
// in the collection dialog (nothing on disk moves, no item changes).
func setFolder(t *testing.T, repos testRepos, id int64, folder string) {
	t.Helper()
	c, err := repos.collections.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	c.RootPath = folder
	if err := repos.collections.Update(context.Background(), id, c); err != nil {
		t.Fatalf("renaming folder of %d to %q: %v", id, folder, err)
	}
}

func updateCollection(t *testing.T, repos testRepos, id int64, mutate func(*models.Collection)) {
	t.Helper()
	c, err := repos.collections.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	mutate(c)
	if err := repos.collections.Update(context.Background(), id, c); err != nil {
		t.Fatalf("updating collection %d: %v", id, err)
	}
}

// folderChain is a collection's folder chain from the media root, "a/b".
func folderChain(cols map[int64]models.Collection, id int64) string {
	var segs []string
	for cur := &id; cur != nil; {
		c := cols[*cur]
		segs = append([]string{c.RootPath}, segs...)
		cur = c.ParentID
	}
	return strings.Join(segs, "/")
}

func collectionMap(t *testing.T, repos testRepos) map[int64]models.Collection {
	t.Helper()
	cols, err := repos.collections.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := make(map[int64]models.Collection, len(cols))
	for _, c := range cols {
		m[c.ID] = c
	}
	return m
}

// collectionLines lists every collection as "folder-chain | name=… | quality=… |
// private=…", sorted, so a whole library can be compared in one assertion.
func collectionLines(t *testing.T, repos testRepos) []string {
	t.Helper()
	m := collectionMap(t, repos)
	var out []string
	for id, c := range m {
		line := folderChain(m, id) + " | name=" + c.Name + " | quality=" + c.DefaultQuality
		if c.IsPrivate {
			line += " | private"
		}
		out = append(out, line)
	}
	sort.Strings(out)
	return out
}

// itemPlacement maps an item title to the folder chains of the collections its
// rows sit in ("(none)" for an uncategorized row), sorted. Restoring into a
// library that already holds the original items adds a ghost beside each one,
// so a title can have two entries.
func itemPlacement(t *testing.T, repos testRepos) map[string][]string {
	t.Helper()
	cols := collectionMap(t, repos)
	items, err := repos.library.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]string{}
	for _, it := range items {
		where := "(none)"
		if it.CollectionID != nil {
			where = folderChain(cols, *it.CollectionID)
		}
		out[it.Title] = append(out[it.Title], it.Status+"@"+where)
	}
	for k := range out {
		sort.Strings(out[k])
	}
	return out
}

func assertLines(t *testing.T, got, want []string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("collections differ.\n got:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

func assertPlacement(t *testing.T, got map[string][]string, title string, want ...string) {
	t.Helper()
	if strings.Join(got[title], ",") != strings.Join(want, ",") {
		t.Fatalf("item %q placed at %v, want %v (all: %v)", title, got[title], want, got)
	}
}

// sceneLines is the library as seeded, before anything is renamed.
var sceneLines = []string{
	"Podcasts | name=Podcasts | quality=best",
	"Shows | name=Shows | quality=best",
	"Shows/Anime | name=Anime | quality=720p",
	"concerts | name=Concerts | quality=1080p | private",
}

// (a) Baseline: restoring into an EMPTY library creates every collection with
// its settings and attaches each restored item to it.
func TestBundleRestore_IntoEmptyLibrary(t *testing.T) {
	src := seedRenameScene(t)
	bundle := src.export(t)

	empty := openTestRepos(t)
	resolved, result := restoreBundle(t, empty, bundle, true)

	assertLines(t, collectionLines(t, empty), sceneLines)
	if result.CollectionsEnsured != 4 || result.GhostsCreated != 3 {
		t.Fatalf("result = %+v, want 4 collections ensured and 3 ghosts", result)
	}
	if len(resolved) != 0 {
		t.Fatalf("ghostOnly must queue nothing, got %d resolved downloads", len(resolved))
	}
	place := itemPlacement(t, empty)
	assertPlacement(t, place, "Gig", "ghost@concerts")
	assertPlacement(t, place, "Ep1", "ghost@Shows/Anime")
	assertPlacement(t, place, "Pod1", "ghost@Podcasts")

	// The nested collection hangs off the restored parent, and the metadata
	// that is not part of the chain (Jellyfin library) came across.
	cols := collectionMap(t, empty)
	for _, c := range cols {
		if c.RootPath == "Anime" && (c.ParentID == nil || cols[*c.ParentID].RootPath != "Shows") {
			t.Fatalf("Anime must sit under Shows, got parent %v", c.ParentID)
		}
		if c.RootPath == "concerts" && (c.JellyfinLibrary == nil || *c.JellyfinLibrary != "jf-1") {
			t.Fatalf("Jellyfin library not restored: %v", c.JellyfinLibrary)
		}
	}
}

// (b) Restoring into the SAME library with nothing renamed (the common case):
// every collection is reused, none is duplicated, the restored items attach to
// the existing collections.
func TestBundleRestore_SameLibraryNothingRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	idsBefore := collectionMap(t, s.repos)

	// Download mode: the resolved downloads point at the EXISTING collections.
	resolved, result := restoreBundle(t, s.repos, bundle, false)
	assertLines(t, collectionLines(t, s.repos), sceneLines)
	if got := collectionMap(t, s.repos); len(got) != len(idsBefore) {
		t.Fatalf("collections went from %d to %d", len(idsBefore), len(got))
	}
	for id, c := range idsBefore {
		if got := collectionMap(t, s.repos)[id]; got.RootPath != c.RootPath || got.Name != c.Name {
			t.Fatalf("collection %d changed from %+v to %+v", id, c, got)
		}
	}
	if result.CollectionsEnsured != 4 {
		t.Fatalf("CollectionsEnsured = %d, want 4 (it counts matched collections too)", result.CollectionsEnsured)
	}
	want := map[string]int64{"gig": s.concerts, "ep1": s.anime, "pod1": s.podcasts}
	if len(resolved) != 3 {
		t.Fatalf("resolved %d downloads, want 3", len(resolved))
	}
	for _, r := range resolved {
		key := r.URL[strings.LastIndex(r.URL, "/")+1:]
		key = strings.TrimSuffix(key, ".mp4")
		if r.CollectionID == nil || *r.CollectionID != want[key] {
			t.Fatalf("download %s resolved to collection %v, want %d", r.URL, r.CollectionID, want[key])
		}
	}

	// Ghost mode: the ghosts attach to the same existing collections.
	_, result = restoreBundle(t, s.repos, bundle, true)
	assertLines(t, collectionLines(t, s.repos), sceneLines)
	if result.GhostsCreated != 3 {
		t.Fatalf("GhostsCreated = %d, want 3", result.GhostsCreated)
	}
	place := itemPlacement(t, s.repos)
	assertPlacement(t, place, "Gig", "completed@concerts", "ghost@concerts")
	assertPlacement(t, place, "Ep1", "completed@Shows/Anime", "ghost@Shows/Anime")
}

// derefStr renders a nullable value for comparison (nil is "<nil>").
func derefStr[T any](p *T) string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprint(*p)
}

func previewOf(t *testing.T, repos testRepos, b LibraryBundle) LibraryBundlePreview {
	t.Helper()
	prev, err := PreviewLibraryBundle(context.Background(), repos.collections, repos.tags, repos.artists, repos.library, b)
	if err != nil {
		t.Fatalf("PreviewLibraryBundle: %v", err)
	}
	return prev
}

// resolvedTo finds the download for url suffix "/<key>" and returns its collection id (nil = none).
func resolvedTo(t *testing.T, resolved []ResolvedDownload, key string) *int64 {
	t.Helper()
	for i := range resolved {
		if strings.HasSuffix(resolved[i].URL, "/"+key) {
			return resolved[i].CollectionID
		}
	}
	t.Fatalf("no resolved download for %q in %+v", key, resolved)
	return nil
}

func assertResolvedTo(t *testing.T, resolved []ResolvedDownload, key string, want int64) {
	t.Helper()
	got := resolvedTo(t, resolved, key)
	if got == nil || *got != want {
		t.Fatalf("download %q resolved to %v, want collection %d", key, got, want)
	}
}

func assertNoUnresolved(t *testing.T, r ApplyResult) {
	t.Helper()
	if len(r.UnresolvedCollections) != 0 {
		t.Fatalf("unexpected unresolved collections: %+v", r.UnresolvedCollections)
	}
}

// assertMatched checks the single "matched by name" report: the bundle's chain
// and the folder chain of the collection it matched.
func assertMatched(t *testing.T, r ApplyResult, wantPath, wantExisting string) {
	t.Helper()
	if r.CollectionsMatchedByName != 1 || len(r.MatchedByName) != 1 {
		t.Fatalf("matched by name = %d %+v, want exactly 1", r.CollectionsMatchedByName, r.MatchedByName)
	}
	m := r.MatchedByName[0]
	if strings.Join(m.Path, "/") != wantPath || strings.Join(m.ExistingPath, "/") != wantExisting {
		t.Fatalf("matched %v -> %v, want %s -> %s", m.Path, m.ExistingPath, wantPath, wantExisting)
	}
}

// (c1) A top-level collection whose folder was renamed after the export, with
// a display name that differs from the old folder ("Concerts" / concerts ->
// live). The segment `concerts` matches no folder, so the entry's display name
// ("Concerts") finds the renamed collection: the restored items go to it,
// nothing is created, and its privacy and quality stay as the user left them.
func TestBundleRestore_TopLevelFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.concerts, "live") // files stay in concerts/, per the docs
	// Edits made after the backup must survive the restore.
	updateCollection(t, s.repos, s.concerts, func(c *models.Collection) {
		c.DefaultQuality = "480p"
		c.IsPrivate = false
	})

	// The preview says "will use existing collection", not "new collection".
	prev := previewOf(t, s.repos, bundle)
	if prev.CollectionsNew != 0 || prev.CollectionsMatchedByName != 1 || len(prev.UnresolvedCollections) != 0 {
		t.Fatalf("preview new=%d matchedByName=%d unresolved=%v, want 0/1/none", prev.CollectionsNew, prev.CollectionsMatchedByName, prev.UnresolvedCollections)
	}
	for _, c := range prev.Collections {
		if strings.Join(c.Path, "/") == "concerts" {
			if c.IsNew || !c.MatchedByName || strings.Join(c.ExistingPath, "/") != "live" {
				t.Fatalf("preview entry for concerts = %+v, want matched by name -> live", c)
			}
		}
	}

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Anime | quality=720p",
		"live | name=Concerts | quality=480p", // the live collection, untouched (public, 480p)
	})
	if result.CollectionsEnsured != 4 || result.CollectionsCreated != 0 {
		t.Fatalf("result = %+v, want 4 ensured and 0 created", result)
	}
	assertMatched(t, result, "concerts", "live")
	assertNoUnresolved(t, result)
	assertResolvedTo(t, resolved, "gig", s.concerts)

	// Ghost mode puts the placeholder in the renamed collection as well.
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Gig", "completed@live", "ghost@live")
}

// (c2) Same rename, but the display name equals the old folder name
// ("Podcasts" / Podcasts -> Pods), which is how a collection created by name
// usually looks. It used to be refused as a duplicate name and swallowed, so
// the items fell to "no collection"; the display name now finds it.
func TestBundleRestore_TopLevelFolderRenamed_DisplayNameEqualsOldFolder(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.podcasts, "Pods")

	prev := previewOf(t, s.repos, bundle)
	if prev.CollectionsNew != 0 || prev.CollectionsMatchedByName != 1 {
		t.Fatalf("preview new=%d matchedByName=%d, want 0/1", prev.CollectionsNew, prev.CollectionsMatchedByName)
	}

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Pods | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	if result.CollectionsEnsured != 4 || result.CollectionsCreated != 0 {
		t.Fatalf("result = %+v, want 4 ensured and 0 created", result)
	}
	assertMatched(t, result, "Podcasts", "Pods")
	assertNoUnresolved(t, result)
	assertResolvedTo(t, resolved, "pod1", s.podcasts)
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Pod1", "completed@Pods", "ghost@Pods")
}

// (d1) Renaming the PARENT's folder of a nested collection (Shows -> Series):
// the parent is matched by its display name and the whole subtree resolves
// under it (Anime by folder), so nothing is duplicated or left uncategorized.
func TestBundleRestore_ParentFolderRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.shows, "Series")

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=Shows | quality=best",
		"Series/Anime | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertMatched(t, result, "Shows", "Series") // only the parent needed the name; Anime matched by folder under it
	assertNoUnresolved(t, result)
	assertResolvedTo(t, resolved, "ep1", s.anime)
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Series/Anime", "ghost@Series/Anime")
}

// (d1b) Same parent rename, but the parent's display name differs from its old
// folder: matched by name all the same, no duplicate subtree.
func TestBundleRestore_ParentFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	updateCollection(t, s.repos, s.shows, func(c *models.Collection) { c.Name = "TV" })
	bundle := s.export(t)
	setFolder(t, s.repos, s.shows, "Series")

	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=TV | quality=best",
		"Series/Anime | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertMatched(t, result, "Shows", "Series")
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Series/Anime", "ghost@Series/Anime")
}

// (d2) Renaming only the LEAF's folder (Anime -> Cartoons): Shows matches by
// folder, the leaf by display name under it.
func TestBundleRestore_LeafFolderRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.anime, "Cartoons")

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Cartoons | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertMatched(t, result, "Shows/Anime", "Shows/Cartoons")
	assertNoUnresolved(t, result)
	assertResolvedTo(t, resolved, "ep1", s.anime)
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Cartoons", "ghost@Shows/Cartoons")
}

// (d2b) Leaf folder renamed AND its display name differs from the old folder.
func TestBundleRestore_LeafFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	updateCollection(t, s.repos, s.anime, func(c *models.Collection) { c.Name = "Animation" })
	bundle := s.export(t)
	setFolder(t, s.repos, s.anime, "Cartoons")

	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Cartoons | name=Animation | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertMatched(t, result, "Shows/Anime", "Shows/Cartoons")
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Cartoons", "ghost@Shows/Cartoons")
}

// (d3) Mixed: the parent AND the leaf were renamed. Each level is matched by
// name under the one matched above it.
func TestBundleRestore_ParentAndLeafFoldersRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.shows, "Series")
	setFolder(t, s.repos, s.anime, "Cartoons")

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=Shows | quality=best",
		"Series/Cartoons | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	if result.CollectionsMatchedByName != 2 || result.CollectionsCreated != 0 {
		t.Fatalf("result = %+v, want 2 matched by name and 0 created", result)
	}
	assertNoUnresolved(t, result)
	assertResolvedTo(t, resolved, "ep1", s.anime)
}

// (e) Case-variant folder names. FindChildByRootPath prefers an exact match and
// falls back to a case-insensitive one, because creating the variant as a second
// sibling is refused (ErrDuplicateRootPath). A restore onto a library whose
// folder differs from the bundle only in case reuses the collection (matched by
// folder, so not "by name") and leaves it as it is; the preview agrees.
func TestBundleRestore_CaseVariantFolder(t *testing.T) {
	// Bundle written where the folder is "Concerts"; the target library has "concerts".
	src := openTestRepos(t)
	id, err := src.collections.Create(context.Background(), &models.Collection{Name: "Concerts", RootPath: "Concerts", DefaultQuality: "1080p", DefaultDownloadType: "video"})
	if err != nil {
		t.Fatal(err)
	}
	url := "https://example.com/gig"
	if _, err := src.library.Create(context.Background(), &models.LibraryItem{Title: "Gig", Filename: "gig.mp4", Path: "Concerts/gig.mp4", CollectionID: &id, OriginalURL: &url, Status: "completed"}); err != nil {
		t.Fatal(err)
	}
	bundle := exportBundle(t, src)

	dst := openTestRepos(t)
	local, err := dst.collections.Create(context.Background(), &models.Collection{Name: "Concerts", RootPath: "concerts", DefaultQuality: "best", DefaultDownloadType: "video"})
	if err != nil {
		t.Fatal(err)
	}

	prev := previewOf(t, dst, bundle)
	if prev.CollectionsNew != 0 || prev.CollectionsMatchedByName != 0 || len(prev.UnresolvedCollections) != 0 {
		t.Fatalf("preview new=%d byName=%d unresolved=%v, want 0/0/none", prev.CollectionsNew, prev.CollectionsMatchedByName, prev.UnresolvedCollections)
	}

	resolved, result := restoreBundle(t, dst, bundle, false)

	// Reused, folder spelling kept, and NOT modified: the entry's 1080p is not applied.
	assertLines(t, collectionLines(t, dst), []string{"concerts | name=Concerts | quality=best"})
	assertResolvedTo(t, resolved, "gig", local)
	if result.CollectionsMatchedByName != 0 || result.CollectionsCreated != 0 {
		t.Fatalf("result = %+v, want a plain folder match", result)
	}

	// Nested: bundle "Shows/Anime" onto a library holding "shows/anime".
	dst2 := openTestRepos(t)
	p, _ := dst2.collections.Create(context.Background(), &models.Collection{Name: "Shows", RootPath: "shows", DefaultQuality: "best", DefaultDownloadType: "video"})
	if _, err := dst2.collections.Create(context.Background(), &models.Collection{Name: "Anime", RootPath: "anime", ParentID: &p, DefaultQuality: "best", DefaultDownloadType: "video"}); err != nil {
		t.Fatal(err)
	}
	nested := LibraryBundle{
		Collections:  []CollectionEntry{{Path: []string{"Shows", "Anime"}, Name: "Anime", DefaultQuality: "best", DefaultDownloadType: "video"}},
		LibraryItems: []LibraryItemEntry{{Title: "Ep", Filename: "ep.mp4", CollectionPath: []string{"Shows", "Anime"}}},
	}
	if prev := previewOf(t, dst2, nested); prev.CollectionsNew != 0 {
		t.Fatalf("nested preview CollectionsNew = %d, want 0", prev.CollectionsNew)
	}
	restoreBundle(t, dst2, nested, true)
	assertPlacement(t, itemPlacement(t, dst2), "Ep", "ghost@shows/anime")
	if n := len(collectionMap(t, dst2)); n != 2 {
		t.Fatalf("expected the two existing collections to be reused, have %d", n)
	}
}

// (e2) Rows from before the sibling-folder rule can still hold two siblings
// that differ only in case; the exact spelling wins, so each restores into its
// own collection and neither is merged.
func TestBundleRestore_LegacyCaseSiblingsExactMatchWins(t *testing.T) {
	repos := openTestRepos(t)
	ctx := context.Background()
	for _, row := range [][2]string{{"Upper", "Concerts"}, {"Lower", "concerts"}} {
		if _, err := repos.db.ExecContext(ctx, `INSERT INTO collections (name, root_path, default_quality, default_download_type, filename_template) VALUES (?, ?, 'best', 'video', '{title}')`, row[0], row[1]); err != nil {
			t.Fatal(err)
		}
	}
	bundle := LibraryBundle{LibraryItems: []LibraryItemEntry{
		{Title: "U", Filename: "u.mp4", CollectionPath: []string{"Concerts"}},
		{Title: "L", Filename: "l.mp4", CollectionPath: []string{"concerts"}},
	}}
	restoreBundle(t, repos, bundle, true)
	place := itemPlacement(t, repos)
	assertPlacement(t, place, "U", "ghost@Concerts")
	assertPlacement(t, place, "L", "ghost@concerts")
	if n := len(collectionMap(t, repos)); n != 2 {
		t.Fatalf("collections = %d, want 2", n)
	}
}

// (f) The collection's DISPLAY name renamed while the folder stays: matched by
// folder, and the live collection is NOT modified: name, default quality, privacy,
// Jellyfin library, season and artist all stay as the user left them. A
// collection made private after the backup stays private.
func TestBundleRestore_DisplayNameRenamedFolderUnchanged(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	ctx := context.Background()
	artist, err := s.repos.artists.CreateWithPrivacy(ctx, "Someone", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	season, jf := 3, "jf-later"
	updateCollection(t, s.repos, s.anime, func(c *models.Collection) {
		c.Name = "Animation"
		c.DefaultQuality = "480p"
		c.DefaultDownloadType = "audio"
		c.IsPrivate = true // made private AFTER the backup
		c.JellyfinLibrary = &jf
		c.SeasonNumber = &season
		c.ArtistID = &artist.ID
	})
	updateCollection(t, s.repos, s.podcasts, func(c *models.Collection) { c.IsPrivate = true })
	before := collectionMap(t, s.repos)

	prev := previewOf(t, s.repos, bundle)
	if prev.CollectionsNew != 0 || prev.CollectionsMatchedByName != 0 {
		t.Fatalf("preview new=%d byName=%d, want 0/0", prev.CollectionsNew, prev.CollectionsMatchedByName)
	}

	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best | private",
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Animation | quality=480p | private",
		"concerts | name=Concerts | quality=1080p | private",
	})
	after := collectionMap(t, s.repos)
	if len(after) != len(before) {
		t.Fatalf("collections went from %d to %d", len(before), len(after))
	}
	for id, b := range before {
		a := after[id]
		if a.Name != b.Name || a.RootPath != b.RootPath || a.IsPrivate != b.IsPrivate || a.DefaultQuality != b.DefaultQuality ||
			a.DefaultDownloadType != b.DefaultDownloadType || derefStr(a.JellyfinLibrary) != derefStr(b.JellyfinLibrary) ||
			derefStr(a.SeasonNumber) != derefStr(b.SeasonNumber) || derefStr(a.ArtistID) != derefStr(b.ArtistID) ||
			!a.UpdatedAt.Equal(b.UpdatedAt) {
			t.Fatalf("collection %d was modified: before %+v, after %+v", id, b, a)
		}
	}
	if result.CollectionsCreated != 0 || result.CollectionsMatchedByName != 0 {
		t.Fatalf("result = %+v, want plain folder matches", result)
	}
	assertNoUnresolved(t, result)
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Anime", "ghost@Shows/Anime")
}

// (f2) The display name renamed to something a sibling already uses. The
// collection is matched by folder and left completely as it is (it used to be
// skipped whole by a clashing update; now nothing is written to it at all).
func TestBundleRestore_ExistingCollectionUntouchedWhenBundleNameIsTaken(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	updateCollection(t, s.repos, s.concerts, func(c *models.Collection) {
		c.Name = "Live"
		c.IsPrivate = false
	})
	// Podcasts takes the name the Concerts entry carries.
	updateCollection(t, s.repos, s.podcasts, func(c *models.Collection) { c.Name = "Concerts" })

	_, result := restoreBundle(t, s.repos, bundle, true)

	cols := collectionMap(t, s.repos)
	if cols[s.concerts].Name != "Live" || cols[s.concerts].IsPrivate || cols[s.podcasts].Name != "Concerts" {
		t.Fatalf("existing collections must be left as they are, got %+v / %+v", cols[s.concerts], cols[s.podcasts])
	}
	assertNoUnresolved(t, result)
	assertPlacement(t, itemPlacement(t, s.repos), "Gig", "completed@concerts", "ghost@concerts")
}

// A collection the restore CREATES takes all of the entry's settings.
func TestBundleRestore_CreatedCollectionGetsEntrySettings(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	if _, err := repos.artists.CreateWithPrivacy(ctx, "Someone", nil, false); err != nil {
		t.Fatal(err)
	}
	jf, season := "jf-9", 2
	bundle := LibraryBundle{
		Artists: []ArtistEntry{{Name: "Someone"}},
		Collections: []CollectionEntry{{
			Path: []string{"Fresh"}, Name: "Fresh Name", DefaultQuality: "720p", DefaultDownloadType: "audio",
			IsPrivate: true, JellyfinLibrary: &jf, SeasonNumber: &season, ArtistName: "Someone",
		}},
		LibraryItems: []LibraryItemEntry{{Title: "T", Filename: "t.mp3", CollectionPath: []string{"Fresh"}}},
	}

	prev := previewOf(t, repos, bundle)
	if prev.CollectionsNew != 1 {
		t.Fatalf("preview CollectionsNew = %d, want 1", prev.CollectionsNew)
	}
	_, result := restoreBundle(t, repos, bundle, true)

	if result.CollectionsCreated != 1 || result.CollectionsMatchedByName != 0 {
		t.Fatalf("result = %+v", result)
	}
	cols, _ := repos.collections.List(ctx)
	if len(cols) != 1 {
		t.Fatalf("collections = %+v", cols)
	}
	c := cols[0]
	if c.Name != "Fresh Name" || c.RootPath != "Fresh" || c.DefaultQuality != "720p" || c.DefaultDownloadType != "audio" || !c.IsPrivate ||
		c.JellyfinLibrary == nil || *c.JellyfinLibrary != jf || c.SeasonNumber == nil || *c.SeasonNumber != season || c.ArtistID == nil {
		t.Fatalf("created collection did not take the entry's settings: %+v", c)
	}
}

// A created collection whose display name is already used by a sibling that
// this restore created (a hand-edited bundle can carry two entries with one
// name; an existing collection with that name would have been matched instead)
// keeps the folder name as its name, still takes every other setting, privacy
// included, and the clash is reported.
func TestBundleRestore_CreatedCollectionNameClashKeepsSettings(t *testing.T) {
	repos := openTestRepos(t)
	bundle := LibraryBundle{
		Collections: []CollectionEntry{
			{Path: []string{"a"}, Name: "Same", DefaultQuality: "best", DefaultDownloadType: "video"},
			{Path: []string{"b"}, Name: "Same", DefaultQuality: "1080p", DefaultDownloadType: "video", IsPrivate: true},
		},
		LibraryItems: []LibraryItemEntry{{Title: "B1", Filename: "b1.mp4", CollectionPath: []string{"b"}}},
	}

	prev := previewOf(t, repos, bundle)
	if prev.CollectionsNew != 2 || len(prev.CollectionsNameKept) != 1 || len(prev.UnresolvedCollections) != 0 {
		t.Fatalf("preview = new %d, nameKept %+v, unresolved %+v", prev.CollectionsNew, prev.CollectionsNameKept, prev.UnresolvedCollections)
	}
	_, result := restoreBundle(t, repos, bundle, true)

	assertLines(t, collectionLines(t, repos), []string{
		"a | name=Same | quality=best",
		"b | name=b | quality=1080p | private", // name kept as the folder, settings and privacy applied
	})
	if len(result.CollectionsNameKept) != 1 {
		t.Fatalf("nameKept = %+v, want one report", result.CollectionsNameKept)
	}
	k := result.CollectionsNameKept[0]
	if strings.Join(k.Path, "/") != "b" || k.WantedName != "Same" || k.KeptName != "b" {
		t.Fatalf("nameKept = %+v", k)
	}
	assertNoUnresolved(t, result)
	assertPlacement(t, itemPlacement(t, repos), "B1", "ghost@b")
}

// No folder match and no name match: a new collection, as before.
func TestBundleRestore_NoFolderAndNoNameMatchCreates(t *testing.T) {
	s := seedRenameScene(t)
	bundle := LibraryBundle{
		Collections:  []CollectionEntry{{Path: []string{"Brand"}, Name: "Brand New", DefaultQuality: "480p", DefaultDownloadType: "video", IsPrivate: true}},
		LibraryItems: []LibraryItemEntry{{Title: "N", Filename: "n.mp4", CollectionPath: []string{"Brand"}}},
	}
	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), append([]string{"Brand | name=Brand New | quality=480p | private"}, sceneLines...))
	if result.CollectionsCreated != 1 || result.CollectionsMatchedByName != 0 {
		t.Fatalf("result = %+v", result)
	}
}

// Two levels where only the PARENT matches by name: the child does not exist
// under it, so it is created there (not next to a stale parent) with its settings.
func TestBundleRestore_OnlyParentMatchesByName(t *testing.T) {
	s := seedRenameScene(t)
	bundle := LibraryBundle{
		Collections: []CollectionEntry{
			{Path: []string{"Shows"}, Name: "Shows", DefaultQuality: "best", DefaultDownloadType: "video"},
			{Path: []string{"Shows", "Docs"}, Name: "Documentaries", DefaultQuality: "1080p", DefaultDownloadType: "video", IsPrivate: true},
		},
		LibraryItems: []LibraryItemEntry{{Title: "D", Filename: "d.mp4", CollectionPath: []string{"Shows", "Docs"}}},
	}
	setFolder(t, s.repos, s.shows, "Series")

	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=Shows | quality=best",
		"Series/Anime | name=Anime | quality=720p",
		"Series/Docs | name=Documentaries | quality=1080p | private",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertMatched(t, result, "Shows", "Series")
	if result.CollectionsCreated != 1 {
		t.Fatalf("result = %+v, want 1 created", result)
	}
	assertPlacement(t, itemPlacement(t, s.repos), "D", "ghost@Series/Docs")
}

// A level whose bundle entry is missing has no name to match, so it falls back
// to folder-only: here "Shows" was renamed, the bundle only has an entry for the
// leaf, so "Shows" matches nothing and cannot be created (its folder name is the
// display name of the renamed collection). That is reported, not silent.
func TestBundleRestore_MissingEntryFallsBackToFolderOnly(t *testing.T) {
	s := seedRenameScene(t)
	bundle := LibraryBundle{
		Collections:  []CollectionEntry{{Path: []string{"Shows", "Anime"}, Name: "Anime", DefaultQuality: "720p", DefaultDownloadType: "video"}},
		LibraryItems: []LibraryItemEntry{{Title: "Ep1", Filename: "ep1.mp4", CollectionPath: []string{"Shows", "Anime"}}},
	}
	setFolder(t, s.repos, s.shows, "Series")

	prev := previewOf(t, s.repos, bundle)
	if len(prev.UnresolvedCollections) != 1 || prev.UnresolvedCollections[0].Items != 1 || prev.CollectionsMatchedByName != 0 {
		t.Fatalf("preview unresolved = %+v byName=%d", prev.UnresolvedCollections, prev.CollectionsMatchedByName)
	}

	before := collectionLines(t, s.repos)
	_, result := restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), before)
	if len(result.UnresolvedCollections) != 1 {
		t.Fatalf("unresolved = %+v, want exactly one (the root cause, not every descendant)", result.UnresolvedCollections)
	}
	u := result.UnresolvedCollections[0]
	if strings.Join(u.Path, "/") != "Shows" || u.Reason == "" || u.Items != 1 {
		t.Fatalf("unresolved = %+v, want Shows with a reason and 1 item", u)
	}
	if result.CollectionsMatchedByName != 0 {
		t.Fatalf("a level without an entry must not be matched by name: %+v", result)
	}
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Series/Anime", "ghost@(none)")
}

// A level with a folder match but no entry still works (folder-only): no entry
// is needed to reuse an existing collection.
func TestBundleRestore_ItemsOnlyBundleMatchesByFolder(t *testing.T) {
	s := seedRenameScene(t)
	bundle := LibraryBundle{LibraryItems: []LibraryItemEntry{{Title: "G2", Filename: "g2.mp4", CollectionPath: []string{"concerts"}}}}
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "G2", "ghost@concerts")
	if n := len(collectionMap(t, s.repos)); n != 4 {
		t.Fatalf("collections = %d, want 4", n)
	}
}

// A chain that cannot be matched or created: the restore does not fail, the
// items come back uncategorized (ghost mode and download mode), and the result
// lists the chain with a reason and the item count. Reproduced with two legacy
// siblings that share one display name (made before the uniqueness rule): the
// name is ambiguous, so it matches neither, and creating a third is refused.
func TestBundleRestore_UnresolvedChainIsReportedItemsStayUncategorized(t *testing.T) {
	repos := openTestRepos(t)
	ctx := context.Background()
	for _, folder := range []string{"x", "y"} {
		if _, err := repos.db.ExecContext(ctx, `INSERT INTO collections (name, root_path, default_quality, default_download_type, filename_template) VALUES ('Dup', ?, 'best', 'video', '{title}')`, folder); err != nil {
			t.Fatal(err)
		}
	}
	bundle := LibraryBundle{
		Collections: []CollectionEntry{
			{Path: []string{"Dup"}, Name: "Dup", DefaultQuality: "best", DefaultDownloadType: "video", IsPrivate: true},
			{Path: []string{"Dup", "Sub"}, Name: "Sub", DefaultQuality: "best", DefaultDownloadType: "video"},
		},
		LibraryItems: []LibraryItemEntry{
			{Title: "P1", OriginalURL: "https://example.com/p1", Filename: "p1.mp4", CollectionPath: []string{"Dup"}},
			{Title: "P2", OriginalURL: "https://example.com/p2", Filename: "p2.mp4", CollectionPath: []string{"Dup", "Sub"}},
			{Title: "Ok", OriginalURL: "https://example.com/ok", Filename: "ok.mp4"},
		},
	}

	prev := previewOf(t, repos, bundle)
	if len(prev.UnresolvedCollections) != 1 || prev.UnresolvedCollections[0].Items != 2 {
		t.Fatalf("preview unresolved = %+v, want one chain with 2 items", prev.UnresolvedCollections)
	}

	before := len(collectionMap(t, repos))
	resolved, result := restoreBundle(t, repos, bundle, false)

	if len(collectionMap(t, repos)) != before {
		t.Fatal("nothing may be created for an unresolved chain")
	}
	if len(result.UnresolvedCollections) != 1 {
		t.Fatalf("unresolved = %+v", result.UnresolvedCollections)
	}
	u := result.UnresolvedCollections[0]
	if strings.Join(u.Path, "/") != "Dup" || u.Items != 2 || !strings.Contains(u.Reason, "already used") {
		t.Fatalf("unresolved = %+v, want Dup / 2 items / name already used", u)
	}
	if len(resolved) != 3 {
		t.Fatalf("resolved %d downloads, want all 3 (items still import)", len(resolved))
	}
	for _, key := range []string{"p1", "p2", "ok"} {
		if resolvedTo(t, resolved, key) != nil {
			t.Fatalf("download %q must be uncategorized", key)
		}
	}
	restoreBundle(t, repos, bundle, true)
	place := itemPlacement(t, repos)
	assertPlacement(t, place, "P1", "ghost@(none)")
	assertPlacement(t, place, "P2", "ghost@(none)")
}

// A name that is ambiguous among existing siblings (legacy rows) is never
// guessed: the entry is created instead, under its folder name when the display
// name cannot be used.
func TestBundleRestore_AmbiguousNameIsNotMatched(t *testing.T) {
	repos := openTestRepos(t)
	ctx := context.Background()
	for _, folder := range []string{"x", "y"} {
		if _, err := repos.db.ExecContext(ctx, `INSERT INTO collections (name, root_path, default_quality, default_download_type, filename_template) VALUES ('Dup', ?, 'best', 'video', '{title}')`, folder); err != nil {
			t.Fatal(err)
		}
	}
	bundle := LibraryBundle{Collections: []CollectionEntry{{Path: []string{"old"}, Name: "Dup", DefaultQuality: "720p", DefaultDownloadType: "video", IsPrivate: true}}}

	_, result := restoreBundle(t, repos, bundle, true)

	if result.CollectionsMatchedByName != 0 || result.CollectionsCreated != 1 || len(result.CollectionsNameKept) != 1 {
		t.Fatalf("result = %+v", result)
	}
	assertLines(t, collectionLines(t, repos), []string{
		"old | name=old | quality=720p | private",
		"x | name=Dup | quality=best",
		"y | name=Dup | quality=best",
	})
}

// An older bundle (no new fields anywhere) round-trips: the new result fields
// are always present as empty lists, never null.
func TestBundleRestore_ResultListsAreNeverNull(t *testing.T) {
	repos := openTestRepos(t)
	_, result := restoreBundle(t, repos, LibraryBundle{}, true)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"matchedByName":[]`, `"collectionsNameKept":[]`, `"unresolvedCollections":[]`} {
		if !strings.Contains(string(raw), field) {
			t.Fatalf("result JSON %s lacks %s", raw, field)
		}
	}
}

// Sanity for the error the resolver relies on: creating a collection under a
// taken name is what the repository refuses.
func TestEnsureChain_RefusesAFolderWhoseNameIsTaken(t *testing.T) {
	s := seedRenameScene(t)
	setFolder(t, s.repos, s.podcasts, "Pods")
	_, err := s.repos.collections.EnsureChain(context.Background(), []string{"Podcasts"})
	if !errors.Is(err, repository.ErrDuplicateName) {
		t.Fatalf("EnsureChain error = %v, want ErrDuplicateName", err)
	}
}
