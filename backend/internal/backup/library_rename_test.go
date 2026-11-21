package backup

// Investigation tests: what a library bundle restore does after a collection's
// FOLDER name (root_path) was renamed between the export and the restore.
//
// A bundle refers to collections by the chain of folder names from the media
// root (CollectionEntry.Path / LibraryItemEntry.CollectionPath) and a restore
// matches them with CollectionsRepo.EnsureChain. Renaming a collection's
// folder moves nothing on disk (docs/FEATURES.md, Collections), so the bundle
// and the live library can disagree about the name of a folder. These tests pin
// down what that does TODAY, through the real entry points: BuildLibraryBundle
// -> (JSON, like the file the API writes) -> PreviewLibraryBundle /
// ApplyLibraryBundle. They assert the real behavior; anything that is a problem
// is marked `KNOWN LIMITATION` and is written up in docs/TODO.md. No production
// code is changed by them.

import (
	"context"
	"encoding/json"
	"errors"
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

// (c1) A top-level collection whose folder was renamed after the export, with
// a display name that differs from the old folder ("Concerts" / concerts ->
// live). The prediction held: the segment `concerts` matches nothing, a NEW
// collection is created for it, and the restored items attach to the new one.
//
// What the prediction missed: the bundle entry's settings are not applied to
// the new collection either. ApplyLibraryBundle tries to rename it to the
// bundle's display name ("Concerts"), which clashes with the renamed
// collection, and because that rename is one Update of ALL the entry's fields,
// the whole update is skipped: quality, Jellyfin library and the PRIVATE flag
// are lost too.
//
// KNOWN LIMITATION: after a folder rename a restore creates a second
// collection named after the old folder ("concerts"), the renamed one is left
// without the restored items, and a private collection's items come back
// public (the new collection has isPrivate=false).
func TestBundleRestore_TopLevelFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.concerts, "live") // files stay in concerts/, per the docs

	// The preview does flag it, as "a new collection" (the only warning there is).
	prev, err := PreviewLibraryBundle(context.Background(), s.repos.collections, s.repos.tags, s.repos.artists, s.repos.library, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if prev.CollectionsNew != 1 {
		t.Fatalf("preview CollectionsNew = %d, want 1 (the old folder name looks new)", prev.CollectionsNew)
	}

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Anime | quality=720p",
		"concerts | name=concerts | quality=best", // NEW: named after the folder, defaults, NOT private
		"live | name=Concerts | quality=1080p | private",
	})
	// Same count as an in-place restore: the new collection is counted like a match.
	if result.CollectionsEnsured != 4 {
		t.Fatalf("CollectionsEnsured = %d, want 4", result.CollectionsEnsured)
	}
	cols := collectionMap(t, s.repos)
	var gig *ResolvedDownload
	for i := range resolved {
		if strings.HasSuffix(resolved[i].URL, "/gig") {
			gig = &resolved[i]
		}
	}
	if gig == nil || gig.CollectionID == nil {
		t.Fatalf("the Gig download must resolve to a collection, got %+v", resolved)
	}
	if *gig.CollectionID == s.concerts {
		t.Fatalf("the download went to the renamed collection; expected the new one")
	}
	if got := folderChain(cols, *gig.CollectionID); got != "concerts" {
		t.Fatalf("Gig download collection = %q, want the new \"concerts\"", got)
	}
	if cols[*gig.CollectionID].IsPrivate {
		t.Fatal("expected the new collection to be public (the entry's settings are skipped)")
	}

	// Ghost mode puts the placeholder in the new collection as well.
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Gig", "completed@live", "ghost@concerts")
}

// (c2) Same rename, but the display name equals the old folder name
// ("Podcasts" / Podcasts -> Pods), which is how a collection created by name
// usually looks. EnsureChain creates the missing collection with Name = the
// folder segment, and that name is already taken by the renamed sibling, so
// the create is REFUSED (ErrDuplicateName). ApplyLibraryBundle swallows that
// (ensureCollection returns nil), so nothing is created and the items fall to
// "no collection".
//
// KNOWN LIMITATION: silent data loss of the placement. The restore reports
// success; ghost items are created uncategorized, and a download-mode restore
// resolves them to no collection (the download then lands in the media root
// instead of the collection's folder).
func TestBundleRestore_TopLevelFolderRenamed_DisplayNameEqualsOldFolder(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.podcasts, "Pods")

	resolved, result := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Pods | name=Podcasts | quality=best", // the renamed one, untouched
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	if result.CollectionsEnsured != 3 {
		t.Fatalf("CollectionsEnsured = %d, want 3 (Podcasts could not be ensured)", result.CollectionsEnsured)
	}
	for _, r := range resolved {
		if strings.HasSuffix(r.URL, "/pod1") && r.CollectionID != nil {
			t.Fatalf("Pod1 download resolved to collection %d, want none", *r.CollectionID)
		}
	}
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Pod1", "completed@Pods", "ghost@(none)")
}

// (d1) Renaming the PARENT's folder of a nested collection (Shows -> Series):
// every descendant's chain changes. Shows/Anime no longer matches, the missing
// "Shows" is created under the same rule as above and, since the renamed parent
// is called "Shows" too, REFUSED, so the whole subtree falls to "no collection".
//
// KNOWN LIMITATION: same silent loss as (c2), for every descendant at once.
func TestBundleRestore_ParentFolderRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.shows, "Series")

	resolved, _ := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=Shows | quality=best",
		"Series/Anime | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	for _, r := range resolved {
		if strings.HasSuffix(r.URL, "/ep1") && r.CollectionID != nil {
			t.Fatalf("Ep1 download resolved to collection %d, want none", *r.CollectionID)
		}
	}
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Series/Anime", "ghost@(none)")
}

// (d1b) Same parent rename, but the parent's display name differs from its old
// folder: now the missing "Shows" IS created (as a new top-level collection),
// and a new "Anime" is created under it, so a whole duplicate subtree appears
// next to the renamed one.
//
// KNOWN LIMITATION: a duplicate subtree (Shows/Anime next to Series/Anime). It
// at least carries the bundle's settings, because the name clash that blocks
// the entry's update in (c1)/(d2b) is per parent and the new parent is new.
func TestBundleRestore_ParentFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	updateCollection(t, s.repos, s.shows, func(c *models.Collection) { c.Name = "TV" })
	bundle := s.export(t)
	setFolder(t, s.repos, s.shows, "Series")

	restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Series | name=TV | quality=best",
		"Series/Anime | name=Anime | quality=720p",
		"Shows | name=Shows | quality=best",       // new, from the old folder name
		"Shows/Anime | name=Anime | quality=720p", // new child: its name is free under the NEW parent, so the entry applies
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Series/Anime", "ghost@Shows/Anime")
}

// (d2) Renaming only the LEAF's folder (Anime -> Cartoons): Shows matches, the
// segment Anime matches nothing under it. The create of "Anime" under Shows is
// refused because the renamed child is named "Anime" already, so the items
// lose their collection.
//
// KNOWN LIMITATION: same as (c2).
func TestBundleRestore_LeafFolderRenamed(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	setFolder(t, s.repos, s.anime, "Cartoons")

	resolved, _ := restoreBundle(t, s.repos, bundle, false)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Cartoons | name=Anime | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	for _, r := range resolved {
		if strings.HasSuffix(r.URL, "/ep1") && r.CollectionID != nil {
			t.Fatalf("Ep1 download resolved to collection %d, want none", *r.CollectionID)
		}
	}
	restoreBundle(t, s.repos, bundle, true)
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Cartoons", "ghost@(none)")
}

// (d2b) Leaf folder renamed AND its display name differs: the new child is
// created under the matching parent with the old folder name.
//
// KNOWN LIMITATION: a duplicate leaf next to the renamed one.
func TestBundleRestore_LeafFolderRenamed_DisplayNameDiffers(t *testing.T) {
	s := seedRenameScene(t)
	updateCollection(t, s.repos, s.anime, func(c *models.Collection) { c.Name = "Animation" })
	bundle := s.export(t)
	setFolder(t, s.repos, s.anime, "Cartoons")

	restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), []string{
		"Podcasts | name=Podcasts | quality=best",
		"Shows | name=Shows | quality=best",
		"Shows/Anime | name=Anime | quality=best", // NEW, defaults (entry skipped on the name clash)
		"Shows/Cartoons | name=Animation | quality=720p",
		"concerts | name=Concerts | quality=1080p | private",
	})
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Cartoons", "ghost@Shows/Anime")
}

// (e) Case-variant folder names. FindChildByRootPath prefers an exact match and
// falls back to a case-insensitive one, because creating the variant as a second
// sibling is refused (ErrDuplicateRootPath). So a restore onto a library whose
// folder differs from the bundle only in case REUSES the collection.
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
	resolved, _ := restoreBundle(t, dst, bundle, false)

	assertLines(t, collectionLines(t, dst), []string{"concerts | name=Concerts | quality=1080p"}) // reused, folder spelling kept, entry settings applied
	if len(resolved) != 1 || resolved[0].CollectionID == nil || *resolved[0].CollectionID != local {
		t.Fatalf("download must resolve to the existing collection %d, got %+v", local, resolved)
	}
	// KNOWN LIMITATION (cosmetic): the preview compares chains case-sensitively
	// and the restore does not, so the preview says "1 new collection" for
	// something the restore reuses.
	prev, err := PreviewLibraryBundle(context.Background(), dst.collections, dst.tags, dst.artists, dst.library, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if prev.CollectionsNew != 1 {
		t.Fatalf("preview CollectionsNew = %d, want 1 (case-sensitive comparison)", prev.CollectionsNew)
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

// (f) The collection's DISPLAY name renamed while the folder stays: the restore
// matches by folder, so the existing collection is reused (no duplicate) — but
// the entry then OVERWRITES it with the bundle's values: name, default
// quality/type, privacy, Jellyfin library, season and artist all revert to what
// the backup carried. The code says this is deliberate ("ensureCollection always
// overwrites a matched collection's metadata from the bundle"), but
// docs/FEATURES.md promised "never overwriting existing ones".
//
// KNOWN LIMITATION: a restore into a live library undoes later edits to
// matched collections; notably a collection made private after the backup
// becomes public again.
func TestBundleRestore_DisplayNameRenamedFolderUnchanged(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	updateCollection(t, s.repos, s.anime, func(c *models.Collection) {
		c.Name = "Animation"
		c.DefaultQuality = "480p"
		c.IsPrivate = true
	})
	before := collectionMap(t, s.repos)

	restoreBundle(t, s.repos, bundle, true)

	assertLines(t, collectionLines(t, s.repos), sceneLines) // name, quality and privacy are back to the backup's
	after := collectionMap(t, s.repos)
	if len(after) != len(before) {
		t.Fatalf("collections went from %d to %d", len(before), len(after))
	}
	if after[s.anime].Name != "Anime" || after[s.anime].IsPrivate {
		t.Fatalf("expected the entry to overwrite the edits, got %+v", after[s.anime])
	}
	assertPlacement(t, itemPlacement(t, s.repos), "Ep1", "completed@Shows/Anime", "ghost@Shows/Anime")
}

// (f2) The display name renamed to something a sibling already uses: the
// matched collection's update clashes, so the entry's other fields (privacy,
// defaults) are skipped as well — a restore can then neither rename nor
// re-apply the settings.
func TestBundleRestore_DisplayNameClashSkipsWholeEntry(t *testing.T) {
	s := seedRenameScene(t)
	bundle := s.export(t)
	updateCollection(t, s.repos, s.concerts, func(c *models.Collection) {
		c.Name = "Live"
		c.IsPrivate = false
	})
	// Podcasts takes the name the Concerts entry carries.
	updateCollection(t, s.repos, s.podcasts, func(c *models.Collection) { c.Name = "Concerts" })

	restoreBundle(t, s.repos, bundle, true)

	cols := collectionMap(t, s.repos)
	if cols[s.concerts].Name != "Live" || cols[s.concerts].IsPrivate {
		t.Fatalf("Concerts must be left as is (the clashing update is skipped whole), got %+v", cols[s.concerts])
	}
	assertPlacement(t, itemPlacement(t, s.repos), "Gig", "completed@concerts", "ghost@concerts")
}

// Sanity for the error the c2/d tests rely on: creating a collection under a
// taken name is what the repository refuses, which is what EnsureChain hits.
func TestEnsureChain_RefusesAFolderWhoseNameIsTaken(t *testing.T) {
	s := seedRenameScene(t)
	setFolder(t, s.repos, s.podcasts, "Pods")
	_, err := s.repos.collections.EnsureChain(context.Background(), []string{"Podcasts"})
	if !errors.Is(err, repository.ErrDuplicateName) {
		t.Fatalf("EnsureChain error = %v, want ErrDuplicateName", err)
	}
}
