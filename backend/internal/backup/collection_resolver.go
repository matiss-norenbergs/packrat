package backup

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// The collection resolver turns a bundle's collection chains (root-to-leaf
// folder names) into collections of the local library. ApplyLibraryBundle and
// PreviewLibraryBundle both use it, so the preview says exactly what the
// restore will do.
//
// Each chain is resolved level by level (every prefix of the chain is one
// level, under the collection the previous level resolved to):
//
//  1. a collection at that parent whose folder name equals the segment
//     (exact spelling first, then a case variant: repository.FindChildByRootPath);
//  2. else, when the bundle has an entry for that level, the ONE collection at
//     that parent whose display name equals the entry's name. This finds a
//     collection whose folder was renamed after the backup (renaming a folder
//     moves nothing on disk, so the bundle still has the old one);
//  3. else a new collection is created, carrying the entry's settings.
//
// Only a collection the restore creates takes the entry's settings. A
// collection that already existed (matched by folder or by name) is never
// modified: a backup must not undo later edits, above all it must not make a
// private collection public again.
//
// Nothing here changes CollectionsRepo.EnsureChain, which the untracked-file
// scan/import still uses (folder match only).

// CollectionMatch is a bundle collection that a restore (or its preview)
// matched to an existing collection by display name, because no collection at
// that place had its folder name.
type CollectionMatch struct {
	// Path is the folder chain the bundle uses (the old folder names).
	Path []string `json:"path"`
	// Name is the display name the bundle gives it, which is what matched.
	Name string `json:"name"`
	// ExistingPath is the folder chain of the collection it matched.
	ExistingPath []string `json:"existingPath"`
}

// CollectionNameKept is a collection the restore created whose display name
// from the bundle was already used by a sibling, so it was created under its
// folder name instead (everything else from the entry was still applied).
type CollectionNameKept struct {
	Path       []string `json:"path"`
	WantedName string   `json:"wantedName"`
	KeptName   string   `json:"keptName"`
}

// UnresolvedCollection is a bundle collection that could be neither matched
// nor created. The items that referenced it (or a collection below it) are
// still imported, uncategorized; Items counts them.
type UnresolvedCollection struct {
	Path   []string `json:"path"`
	Reason string   `json:"reason"`
	Items  int      `json:"items"`
}

type levelKind int

const (
	levelFolder  levelKind = iota // matched an existing collection by folder name
	levelName                     // matched an existing collection by display name
	levelCreated                  // created by this restore (or, in a preview, would be)
	levelFailed                   // could be neither matched nor created
)

type resolvedLevel struct {
	kind         levelKind
	id           int64 // negative for a collection a preview only simulates
	name         string
	existingPath []string // levelName: the matched collection's folder chain
	reason       string   // levelFailed (the root cause's reason)
	root         *unresolvedState
}

type unresolvedState struct {
	path   []string
	reason string
	items  int
}

type chainResolver struct {
	ctx  context.Context
	repo *repository.CollectionsRepo // nil: simulate creations (preview)

	// cols is every collection known so far, including the ones created while
	// resolving; existing is the library as it was before and is the only list
	// a display name is matched against, so a collection created by this
	// restore can never be "matched" by a later entry.
	cols     []models.Collection
	existing []models.Collection
	paths    map[int64][]string // folder chain of each existing collection

	entries   map[string]*CollectionEntry
	artistIDs map[string]int64 // may be nil (preview)

	levels      map[string]*resolvedLevel
	nextVirtual int64

	matched    []CollectionMatch
	nameKept   []CollectionNameKept
	unresolved []*unresolvedState
}

// newChainResolver snapshots the library and indexes the bundle's entries by
// chain. repo nil means a dry run. When the same chain appears twice the first
// entry wins.
func newChainResolver(ctx context.Context, repo *repository.CollectionsRepo, cols []models.Collection, entries []CollectionEntry, artistIDs map[string]int64) *chainResolver {
	r := &chainResolver{
		ctx:       ctx,
		repo:      repo,
		cols:      append([]models.Collection(nil), cols...),
		existing:  append([]models.Collection(nil), cols...),
		paths:     collectionPaths(cols),
		entries:   make(map[string]*CollectionEntry, len(entries)),
		artistIDs: artistIDs,
		levels:    make(map[string]*resolvedLevel),
	}
	for i := range entries {
		if len(entries[i].Path) == 0 {
			continue
		}
		key := chainKey(entries[i].Path)
		if _, dup := r.entries[key]; !dup {
			r.entries[key] = &entries[i]
		}
	}
	return r
}

func chainKey(path []string) string { return strings.Join(path, "/") }

// resolve returns the level for the whole of path (len(path) >= 1), resolving
// its ancestors first. Results are memoized per chain.
func (r *chainResolver) resolve(path []string) *resolvedLevel {
	key := chainKey(path)
	if l, ok := r.levels[key]; ok {
		return l
	}
	l := r.resolveUncached(path)
	r.levels[key] = l
	return l
}

func (r *chainResolver) resolveUncached(path []string) *resolvedLevel {
	var parentID *int64
	if len(path) > 1 {
		parent := r.resolve(path[:len(path)-1])
		if parent.kind == levelFailed {
			return &resolvedLevel{kind: levelFailed, reason: parent.reason, root: parent.root}
		}
		id := parent.id
		parentID = &id
	}
	seg := path[len(path)-1]
	entry := r.entries[chainKey(path)]

	if c := repository.FindChildByRootPath(r.cols, parentID, seg); c != nil {
		return &resolvedLevel{kind: levelFolder, id: c.ID, name: c.Name}
	}
	if entry != nil && entry.Name != "" {
		if c := repository.FindUniqueChildByName(r.existing, parentID, entry.Name); c != nil {
			existingPath := r.paths[c.ID]
			r.matched = append(r.matched, CollectionMatch{
				Path: append([]string(nil), path...), Name: entry.Name, ExistingPath: existingPath,
			})
			return &resolvedLevel{kind: levelName, id: c.ID, name: c.Name, existingPath: existingPath}
		}
	}
	return r.create(path, parentID, seg, entry)
}

// create makes the collection for path with the entry's settings (defaults
// when the bundle has no entry for this level) in a single insert, so a clash
// on the display name can never drop the other settings. The entry's name is
// tried first, then the folder name; both taken is the only way this fails.
func (r *chainResolver) create(path []string, parentID *int64, seg string, entry *CollectionEntry) *resolvedLevel {
	col := models.Collection{
		RootPath: seg, ParentID: parentID,
		DefaultQuality: "best", DefaultDownloadType: "video", FilenameTemplate: "{title}",
	}
	candidates := []string{seg}
	wanted := ""
	if entry != nil {
		if entry.DefaultQuality != "" {
			col.DefaultQuality = entry.DefaultQuality
		}
		if entry.DefaultDownloadType != "" {
			col.DefaultDownloadType = entry.DefaultDownloadType
		}
		col.IsPrivate = entry.IsPrivate
		col.JellyfinLibrary = entry.JellyfinLibrary
		col.SeasonNumber = entry.SeasonNumber
		if id, ok := r.artistIDs[entry.ArtistName]; ok && entry.ArtistName != "" {
			col.ArtistID = &id
		}
		if entry.Name != "" && entry.Name != seg {
			wanted = entry.Name
			candidates = []string{entry.Name, seg}
		}
	}

	failReason := ""
	for _, name := range candidates {
		if r.siblingHasName(parentID, name) {
			continue
		}
		col.Name = name
		if r.repo == nil {
			r.nextVirtual--
			col.ID = r.nextVirtual
		} else {
			id, err := r.repo.Create(r.ctx, &col)
			if errors.Is(err, repository.ErrDuplicateName) {
				continue
			}
			if err != nil {
				failReason = "could not be created: " + err.Error()
				break
			}
			col.ID = id
		}
		r.cols = append(r.cols, col)
		if wanted != "" && name != wanted {
			r.nameKept = append(r.nameKept, CollectionNameKept{
				Path: append([]string(nil), path...), WantedName: wanted, KeptName: name,
			})
		}
		return &resolvedLevel{kind: levelCreated, id: col.ID, name: name}
	}
	if failReason == "" {
		failReason = fmt.Sprintf("the name %q is already used by another collection in the same folder", seg)
	}
	root := &unresolvedState{path: append([]string(nil), path...), reason: failReason}
	r.unresolved = append(r.unresolved, root)
	return &resolvedLevel{kind: levelFailed, reason: failReason, root: root}
}

func (r *chainResolver) siblingHasName(parentID *int64, name string) bool {
	for i := range r.cols {
		c := &r.cols[i]
		if c.Name != name || (c.ParentID == nil) != (parentID == nil) {
			continue
		}
		if c.ParentID == nil || *c.ParentID == *parentID {
			return true
		}
	}
	return false
}

// lookup resolves path and returns the collection id, or nil for an empty path
// ("no collection") or an unresolved chain. forItem counts an item that falls
// back to uncategorized against the unresolved collection responsible.
func (r *chainResolver) lookup(path []string, forItem bool) *int64 {
	if len(path) == 0 {
		return nil
	}
	l := r.resolve(path)
	if l.kind == levelFailed {
		if forItem {
			l.root.items++
		}
		return nil
	}
	id := l.id
	return &id
}

func (r *chainResolver) unresolvedReport() []UnresolvedCollection {
	out := make([]UnresolvedCollection, 0, len(r.unresolved))
	for _, u := range r.unresolved {
		out = append(out, UnresolvedCollection{Path: u.path, Reason: u.reason, Items: u.items})
	}
	return out
}

func (r *chainResolver) matchedReport() []CollectionMatch {
	if r.matched == nil {
		return []CollectionMatch{}
	}
	return r.matched
}

func (r *chainResolver) nameKeptReport() []CollectionNameKept {
	if r.nameKept == nil {
		return []CollectionNameKept{}
	}
	return r.nameKept
}
