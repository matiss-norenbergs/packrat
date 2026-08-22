package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"packrat/backend/internal/models"
)

// ResolutionSteps are the standard resolution heights the dashboard's
// resolution-breakdown chart buckets into — mirrors frontend/src/lib/
// resolution.ts's RESOLUTION_STEPS (kept in sync manually, same as that
// file's own comment about UpdateSettingsRequest's oneof= constraint).
var ResolutionSteps = []int{480, 720, 1080, 1440, 2160, 4320}

type LibraryRepo struct {
	db dbtx
}

func NewLibraryRepo(db *sql.DB) *LibraryRepo {
	return &LibraryRepo{db: db}
}

// WithTx returns a copy of r whose queries run against tx instead of the
// underlying connection pool — see TagsRepo.WithTx for the full rationale.
func (r *LibraryRepo) WithTx(tx *sql.Tx) *LibraryRepo {
	cp := *r
	cp.db = tx
	return &cp
}

func (r *LibraryRepo) Create(ctx context.Context, item *models.LibraryItem) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO library (download_id, title, filename, path, collection_id, folder, original_url,
		                      video_id, uploader, duration, resolution, media_type, thumbnail, thumbnail_small_path, thumbnail_medium_path,
		                      description, artist_id, release_year,
		                      sequence_number, season_number, generate_nfo, status, file_size_bytes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.DownloadID, item.Title, item.Filename, item.Path, item.CollectionID, item.Folder, item.OriginalURL,
		item.VideoID, item.Uploader, item.Duration, item.Resolution, item.MediaType, item.Thumbnail, item.ThumbnailSmallPath, item.ThumbnailMediumPath,
		item.Description, item.ArtistID, item.ReleaseYear,
		item.SequenceNumber, item.SeasonNumber, item.GenerateNFO, item.Status, item.FileSizeBytes,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting library item: %w", err)
	}
	return res.LastInsertId()
}

func (r *LibraryRepo) Get(ctx context.Context, id int64) (*models.LibraryItem, error) {
	row := r.db.QueryRowContext(ctx, librarySelectColumns+` WHERE l.id = ?`, id)
	item, err := scanLibraryItem(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return item, err
}

// FindDuplicate returns the library item matching originalURL or videoID
// (either may be empty, in which case that half of the match is skipped),
// or nil if none exists. Used for duplicate-detection before queuing a new
// download — nil-means-not-found, unlike Get's ErrNotFound, since "no
// duplicate" is an expected, non-exceptional outcome here.
func (r *LibraryRepo) FindDuplicate(ctx context.Context, originalURL, videoID string) (*models.LibraryItem, error) {
	if originalURL == "" && videoID == "" {
		return nil, nil
	}

	var conditions []string
	var args []any
	if originalURL != "" {
		conditions = append(conditions, `l.original_url = ?`)
		args = append(args, originalURL)
	}
	if videoID != "" {
		conditions = append(conditions, `l.video_id = ?`)
		args = append(args, videoID)
	}

	query := librarySelectColumns + ` WHERE (` + strings.Join(conditions, " OR ") + `) LIMIT 1`
	row := r.db.QueryRowContext(ctx, query, args...)
	item, err := scanLibraryItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return item, err
}

// DuplicateQuery is one FindDuplicate lookup's input — the batched
// counterpart's per-entry key.
type DuplicateQuery struct {
	URL     string
	VideoID string
}

// FindDuplicates batches FindDuplicate across many URL/videoID pairs into a
// single query instead of one round trip per entry — used by enqueueBatch so
// a large playlist/bulk-download submission with skipDuplicates costs one
// query, not N. The returned map is keyed by the input slice's index;
// entries with no match are simply absent.
func (r *LibraryRepo) FindDuplicates(ctx context.Context, queries []DuplicateQuery) (map[int]*models.LibraryItem, error) {
	result := make(map[int]*models.LibraryItem)
	if len(queries) == 0 {
		return result, nil
	}

	urlSet := make(map[string]bool)
	videoIDSet := make(map[string]bool)
	for _, q := range queries {
		if q.URL != "" {
			urlSet[q.URL] = true
		}
		if q.VideoID != "" {
			videoIDSet[q.VideoID] = true
		}
	}
	if len(urlSet) == 0 && len(videoIDSet) == 0 {
		return result, nil
	}

	var conditions []string
	var args []any
	if len(urlSet) > 0 {
		conditions = append(conditions, `l.original_url IN (`+strings.TrimSuffix(strings.Repeat("?,", len(urlSet)), ",")+`)`)
		for u := range urlSet {
			args = append(args, u)
		}
	}
	if len(videoIDSet) > 0 {
		conditions = append(conditions, `l.video_id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(videoIDSet)), ",")+`)`)
		for v := range videoIDSet {
			args = append(args, v)
		}
	}

	rows, err := r.db.QueryContext(ctx, librarySelectColumns+` WHERE `+strings.Join(conditions, " OR "), args...)
	if err != nil {
		return nil, fmt.Errorf("batch-finding duplicates: %w", err)
	}
	defer rows.Close()

	byURL := make(map[string]*models.LibraryItem)
	byVideoID := make(map[string]*models.LibraryItem)
	for rows.Next() {
		item, err := scanLibraryItem(rows)
		if err != nil {
			return nil, err
		}
		if item.OriginalURL != nil {
			byURL[*item.OriginalURL] = item
		}
		if item.VideoID != nil && *item.VideoID != "" {
			byVideoID[*item.VideoID] = item
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i, q := range queries {
		if q.URL != "" {
			if item, ok := byURL[q.URL]; ok {
				result[i] = item
				continue
			}
		}
		if q.VideoID != "" {
			if item, ok := byVideoID[q.VideoID]; ok {
				result[i] = item
			}
		}
	}
	return result, nil
}

// List returns the entire library, unfiltered — used by call sites that
// genuinely need every row (ListPaths-adjacent bookkeeping, Stats, the item
// detail page's sibling strip), as opposed to Query's search/filter/sort/
// pagination used by the Library page itself.
func (r *LibraryRepo) List(ctx context.Context) ([]models.LibraryItem, error) {
	items, _, err := r.Query(ctx, LibraryQuery{SortKey: "downloadedAt", SortDir: "desc"})
	return items, err
}

// LibraryQuery describes a filtered, sorted, optionally-paginated fetch of
// the library — built by Query into one parameterized SQL statement rather
// than fetching everything and filtering in Go/JS.
type LibraryQuery struct {
	Search             string   // matched via FTS5 MATCH against library_fts (title/filename/uploader/description/folder/original_url); empty = no filter
	CollectionID       *int64   // exact match; nil (with CollectionIDIsNull false) = no filter
	CollectionIDIsNull bool     // true = filter to collection_id IS NULL (uncategorized items) — folder view's root, distinct from "no filter at all"
	CollectionIDs      []int64  // IN-match against a set of ids; used by bulk-selection resolution (a folder + its nested subcollections), independent of CollectionID/CollectionIDIsNull — takes precedence over both when non-empty
	ArtistID           *int64   // exact match on artist_id; nil = no filter
	Year               *int     // exact match on release_year; nil = no filter
	Tags               []string // AND semantics — an item must have every tag
	InProgress         bool     // true = filter to items eligible for "Continue Watching": a position tracked, past the barely-started floor, and short of the credits-rolled ceiling (see continueWatching* constants)
	HideGhosts         bool     // true = exclude ghost (no-file placeholder) items; false = no filter (ghosts show inline like any other item, the default)
	SortKey            string   // downloadedAt|title|filename|year|duration|sequenceNumber|lastWatchedAt
	SortDir            string   // asc|desc
	Page               int      // 1-based; 0 means "no pagination", return every matching row
	PageSize           int      // only used when Page > 0; defaults to 48 if <= 0
}

// Mirrors BrowsePage.tsx's former client-side Continue Watching filter
// (CONTINUE_WATCHING_MIN_SECONDS/CONTINUE_WATCHING_MAX_FRACTION), now
// evaluated in SQL so the endpoint only returns rows actually eligible
// instead of the caller fetching everything to filter itself.
const (
	continueWatchingMinSeconds  = 5
	continueWatchingMaxFraction = 0.95
)

var librarySortColumns = map[string]string{
	"downloadedAt":   "l.downloaded_at",
	"title":          "l.title",
	"filename":       "l.filename",
	"year":           "l.release_year",
	"duration":       "l.duration",
	"sequenceNumber": "l.sequence_number",
	"lastWatchedAt":  "l.last_watched_at",
}

// buildFTSMatchQuery turns free-text user input into a safe FTS5 MATCH
// expression: each whitespace-separated word becomes a quoted prefix term
// (quotes prevent the user's text from being parsed as FTS5 query syntax —
// operators like AND/OR/NOT/NEAR, parens, colons — and doubling any embedded
// quote escapes it). Space-separated terms are implicitly ANDed by FTS5, so
// "big meteor" requires both words to match, in any column, in any order.
func buildFTSMatchQuery(search string) string {
	words := strings.Fields(search)
	parts := make([]string, 0, len(words))
	for _, w := range words {
		escaped := strings.ReplaceAll(w, `"`, `""`)
		parts = append(parts, `"`+escaped+`"*`)
	}
	return strings.Join(parts, " ")
}

// Query builds one parameterized statement covering search + filters + sort
// + optional pagination, returning the matching page (or everything, when
// Page is 0) along with the total match count (for building "Page X of Y").
func (r *LibraryRepo) Query(ctx context.Context, q LibraryQuery) ([]models.LibraryItem, int, error) {
	var joins strings.Builder
	var conditions []string
	var args []any

	if ftsQuery := buildFTSMatchQuery(q.Search); ftsQuery != "" {
		joins.WriteString(` JOIN library_fts ON library_fts.rowid = l.id`)
		conditions = append(conditions, `library_fts MATCH ?`)
		args = append(args, ftsQuery)
	}
	if len(q.CollectionIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(q.CollectionIDs)), ",")
		conditions = append(conditions, `l.collection_id IN (`+placeholders+`)`)
		for _, id := range q.CollectionIDs {
			args = append(args, id)
		}
	} else if q.CollectionIDIsNull {
		conditions = append(conditions, `l.collection_id IS NULL`)
	} else if q.CollectionID != nil {
		conditions = append(conditions, `l.collection_id = ?`)
		args = append(args, *q.CollectionID)
	}
	if q.ArtistID != nil {
		conditions = append(conditions, `l.artist_id = ?`)
		args = append(args, *q.ArtistID)
	}
	if q.Year != nil {
		conditions = append(conditions, `l.release_year = ?`)
		args = append(args, *q.Year)
	}
	if q.InProgress {
		conditions = append(conditions,
			`l.playback_position_seconds IS NOT NULL AND l.playback_position_seconds >= ? AND (l.duration IS NULL OR l.playback_position_seconds < l.duration * ?) AND l.last_watched_at IS NOT NULL`)
		args = append(args, continueWatchingMinSeconds, continueWatchingMaxFraction)
	}
	if q.HideGhosts {
		conditions = append(conditions, `l.status != 'ghost'`)
	}
	for _, tag := range q.Tags {
		conditions = append(conditions, `EXISTS (SELECT 1 FROM library_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.library_id = l.id AND t.name = ?)`)
		args = append(args, tag)
	}

	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	countQuery := `SELECT COUNT(*) FROM library l` + joins.String() + where
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting library items: %w", err)
	}

	sortDir := "DESC"
	if q.SortDir == "asc" {
		sortDir = "ASC"
	}
	// "<col> IS NULL" sorts ASC (0 before 1), so nulls always land last
	// regardless of the requested direction — matches the frontend's old
	// compareValues behavior.
	var orderBy string
	if q.SortKey == "seasonNumber" {
		// The list view's combined Season/Episode column sorts on both
		// fields together (season first, sequence as the tiebreaker within
		// a season) — the only sort key backed by two columns instead of one.
		orderBy = fmt.Sprintf(
			" ORDER BY l.season_number IS NULL, l.season_number %s, l.sequence_number IS NULL, l.sequence_number %s",
			sortDir, sortDir,
		)
	} else {
		sortCol, ok := librarySortColumns[q.SortKey]
		if !ok {
			sortCol = "l.downloaded_at"
		}
		orderBy = fmt.Sprintf(" ORDER BY %s IS NULL, %s %s", sortCol, sortCol, sortDir)
	}

	listQuery := librarySelectPrefix + libraryFromClause + joins.String() + where + orderBy
	listArgs := append([]any{}, args...)
	if q.Page > 0 {
		pageSize := q.PageSize
		if pageSize <= 0 {
			pageSize = 48
		}
		listQuery += " LIMIT ? OFFSET ?"
		listArgs = append(listArgs, pageSize, (q.Page-1)*pageSize)
	}

	rows, err := r.db.QueryContext(ctx, listQuery, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("querying library: %w", err)
	}
	defer rows.Close()

	var out []models.LibraryItem
	for rows.Next() {
		item, err := scanLibraryItem(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *LibraryRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM library WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting library item: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *LibraryRepo) UpdateTitle(ctx context.Context, id int64, title string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET title = ? WHERE id = ?`, title, id)
	if err != nil {
		return fmt.Errorf("updating library title: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateFilename is used by Rename when the physical filename changes —
// the file itself has already been renamed on disk by the caller via
// fsutil.RenamePair before this is called.
func (r *LibraryRepo) UpdateFilename(ctx context.Context, id int64, filename, path string, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET filename = ?, path = ?, thumbnail = ? WHERE id = ?`,
		filename, path, thumbnail, id,
	)
	if err != nil {
		return fmt.Errorf("updating library filename: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateLocation is used by Move — the file has already been relocated on
// disk by the caller via fsutil.RenamePair before this is called.
func (r *LibraryRepo) UpdateLocation(ctx context.Context, id int64, collectionID *int64, folder, filename, path string, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET collection_id = ?, folder = ?, filename = ?, path = ?, thumbnail = ? WHERE id = ?`,
		collectionID, folder, filename, path, thumbnail, id,
	)
	if err != nil {
		return fmt.Errorf("updating library location: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateMetadata is used by Refresh Metadata and the Edit dialog's field
// updates. resolution uses COALESCE since a re-fetch might not include
// width/height — nil leaves the existing value untouched rather than
// clobbering it with an unknown one. artistID/releaseYear/sequenceNumber/
// seasonNumber are plain overwrites (nil clears them), matching how the Edit
// dialog sends them.
func (r *LibraryRepo) UpdateMetadata(ctx context.Context, id int64, title, uploader *string, duration *int, resolution *string, description *string, artistID *int64, releaseYear, sequenceNumber, seasonNumber *int) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library
		SET title = COALESCE(?, title), uploader = ?, duration = ?,
		    resolution = COALESCE(?, resolution), description = ?, artist_id = ?, release_year = ?, sequence_number = ?, season_number = ?
		WHERE id = ?`,
		title, uploader, duration, resolution, description, artistID, releaseYear, sequenceNumber, seasonNumber, id,
	)
	if err != nil {
		return fmt.Errorf("updating library metadata: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateThumbnail sets the item's thumbnail path — used by the
// redownload/quick-grab/choose-from-video thumbnail actions after they've
// written a new sidecar image file.
func (r *LibraryRepo) UpdateThumbnail(ctx context.Context, id int64, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET thumbnail = ? WHERE id = ?`, thumbnail, id)
	if err != nil {
		return fmt.Errorf("updating library thumbnail: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateThumbnailTiers sets the item's small/medium WebP derivative paths
// plus the ORIGINAL sidecar thumbnail's probed pixel dimensions — called
// alongside UpdateThumbnail whenever the original thumbnail is (re)generated,
// and by the one-off backfill tool for pre-existing items. width/height are
// nil when the probe failed (best-effort at every call site).
func (r *LibraryRepo) UpdateThumbnailTiers(ctx context.Context, id int64, small, medium *string, width, height *int) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE library SET thumbnail_small_path = ?, thumbnail_medium_path = ?, thumbnail_width = ?, thumbnail_height = ? WHERE id = ?`,
		small, medium, width, height, id,
	)
	if err != nil {
		return fmt.Errorf("updating library thumbnail tiers: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateThumbnailDimensions sets only the original thumbnail's probed pixel
// dimensions, leaving the small/medium derivative paths untouched — used by
// the backfill sweep for items that already have derivatives generated but
// predate this column.
func (r *LibraryRepo) UpdateThumbnailDimensions(ctx context.Context, id int64, width, height *int) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE library SET thumbnail_width = ?, thumbnail_height = ? WHERE id = ?`,
		width, height, id,
	)
	if err != nil {
		return fmt.Errorf("updating library thumbnail dimensions: %w", err)
	}
	return checkRowsAffected(res)
}

// ThumbnailsByArtist returns the distinct thumbnail paths of every library
// item assigned to an artist — the candidate source for "add from downloaded
// files" in the artist images picker (an artist isn't tied to one folder the
// way a collection is, so this is DB-driven rather than a filesystem walk).
func (r *LibraryRepo) ThumbnailsByArtist(ctx context.Context, artistID int64) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT DISTINCT thumbnail FROM library WHERE artist_id = ? AND thumbnail IS NOT NULL`, artistID)
	if err != nil {
		return nil, fmt.Errorf("listing artist thumbnails: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var thumbnail string
		if err := rows.Scan(&thumbnail); err != nil {
			return nil, fmt.Errorf("scanning artist thumbnail: %w", err)
		}
		out = append(out, thumbnail)
	}
	return out, rows.Err()
}

// LatestThumbnail is one collection's most-recently-downloaded direct item
// that has a thumbnail — the raw ingredient for Browse's "no explicit cover
// set" fallback (see LatestThumbnailsByCollection).
type LatestThumbnail struct {
	Thumbnail    string
	DownloadedAt time.Time
}

// LatestThumbnailsByCollection returns, per collection, the thumbnail of the
// most recently downloaded item placed *directly* in it (mirrors
// CollectionsRepo.ItemCounts' "direct, not rolled up" scope) — callers that
// want a whole show's fallback cover (rolled up across descendants) combine
// this with the collection tree themselves, the same way toCollectionResponse
// rolls up ItemCounts into TotalItemCount. Collections with no thumbnailed
// item of their own are simply absent from the result. One query for the
// whole library rather than a fetch of every item, so Browse can resolve
// fallback covers without ever pulling item rows for collections that
// already have an explicit cover set.
func (r *LibraryRepo) LatestThumbnailsByCollection(ctx context.Context) (map[int64]LatestThumbnail, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT collection_id, thumbnail, downloaded_at FROM (
			SELECT collection_id, thumbnail, downloaded_at,
			       ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY downloaded_at DESC) AS rn
			FROM library
			WHERE collection_id IS NOT NULL AND thumbnail IS NOT NULL
		) WHERE rn = 1`)
	if err != nil {
		return nil, fmt.Errorf("listing latest collection thumbnails: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]LatestThumbnail)
	for rows.Next() {
		var collectionID int64
		var thumbnail, downloadedAt string
		if err := rows.Scan(&collectionID, &thumbnail, &downloadedAt); err != nil {
			return nil, fmt.Errorf("scanning latest collection thumbnail: %w", err)
		}
		t, err := parseSQLiteTime(downloadedAt)
		if err != nil {
			return nil, err
		}
		out[collectionID] = LatestThumbnail{Thumbnail: thumbnail, DownloadedAt: t}
	}
	return out, rows.Err()
}

// SequenceGap describes gaps in one collection's own (direct-items-only —
// same scope as ItemCounts, not the recursive subtree) sequence numbers.
// Min/Max are the smallest/largest sequence_number present; Missing lists up
// to sequenceGapSampleCap of the missing integers in [Min,Max], ascending;
// Count is the true total, which can exceed len(Missing) when the range is
// large (e.g. a mistyped sequence number far from the rest).
type SequenceGap struct {
	Min     int
	Max     int
	Count   int
	Missing []int
}

// sequenceGapSampleCap bounds how many missing numbers SequenceGapsByCollection
// actually collects per collection, so a mistyped sequence number (e.g.
// 100000 instead of 10) can't force building — and shipping to the client on
// every collections-list fetch — a six-figure slice. Count still reports the
// true total.
const sequenceGapSampleCap = 50

// SequenceRange overrides the reported min/max for a collection, when its
// own configured Sequence Min/Max should widen the gap range beyond what's
// merely been placed so far (e.g. items 1-8 exist but the collection expects
// up to 12 — without this, gaps only ever get reported between placed
// items). Either field nil falls back to that item-derived bound.
type SequenceRange struct {
	Min *int
	Max *int
}

// SequenceGapsByCollection returns gap info only for collections that
// actually have one — a collection with zero or one sequence-numbered item
// (nothing to have a "range" in) or a fully dense sequence is absent from
// the map, same convention as LatestThumbnailsByCollection. ranges lets a
// collection's own configured Sequence Min/Max widen the reported range
// beyond its placed items' own min/max; a collection missing from ranges (or
// with nil fields) falls back to the item-derived bound, unchanged from
// before ranges existed.
func (r *LibraryRepo) SequenceGapsByCollection(ctx context.Context, ranges map[int64]SequenceRange) (map[int64]SequenceGap, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT collection_id, sequence_number FROM library
		WHERE collection_id IS NOT NULL AND sequence_number IS NOT NULL
		ORDER BY collection_id, sequence_number`)
	if err != nil {
		return nil, fmt.Errorf("listing sequence numbers: %w", err)
	}
	defer rows.Close()

	values := make(map[int64][]int)
	for rows.Next() {
		var collectionID int64
		var seq int
		if err := rows.Scan(&collectionID, &seq); err != nil {
			return nil, fmt.Errorf("scanning sequence number: %w", err)
		}
		values[collectionID] = append(values[collectionID], seq)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make(map[int64]SequenceGap)
	for collectionID, seqs := range values {
		min, max := seqs[0], seqs[len(seqs)-1] // rows arrive pre-sorted by sequence_number
		if rng, ok := ranges[collectionID]; ok {
			if rng.Min != nil {
				min = *rng.Min
			}
			if rng.Max != nil {
				max = *rng.Max
			}
		}
		if min >= max {
			continue
		}
		present := make(map[int]bool, len(seqs))
		for _, s := range seqs {
			present[s] = true
		}
		gap := SequenceGap{Min: min, Max: max}
		for n := min; n <= max; n++ {
			if present[n] {
				continue
			}
			gap.Count++
			if len(gap.Missing) < sequenceGapSampleCap {
				gap.Missing = append(gap.Missing, n)
			}
		}
		if gap.Count > 0 {
			out[collectionID] = gap
		}
	}
	return out, nil
}

// UpdateGenerateNFO toggles whether a .nfo sidecar file should be kept in
// sync for this item — kept separate from the metadata bundle (UpdateMetadata)
// since toggling it needs to trigger NFO generation itself, not just persist
// a flag.
func (r *LibraryRepo) UpdateGenerateNFO(ctx context.Context, id int64, generateNFO bool) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET generate_nfo = ? WHERE id = ?`, generateNFO, id)
	if err != nil {
		return fmt.Errorf("updating library generate_nfo: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateOriginalURL sets or clears (when url is nil) the item's source URL —
// used both to fill in a URL for a previously URL-less imported item, and by
// the Edit dialog's normal field-editing flow.
func (r *LibraryRepo) UpdateOriginalURL(ctx context.Context, id int64, url *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET original_url = ? WHERE id = ?`, url, id)
	if err != nil {
		return fmt.Errorf("updating library original_url: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdatePlaybackPosition records how far into playback (in seconds) the
// user has gotten, and stamps last_watched_at — powers the Browse page's
// "Continue Watching" row. Called frequently (throttled client-side) while
// a video plays, so it's kept as a narrow, single-purpose update rather
// than folded into UpdateMetadata.
func (r *LibraryRepo) UpdatePlaybackPosition(ctx context.Context, id int64, positionSeconds int) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET playback_position_seconds = ?, last_watched_at = datetime('now') WHERE id = ?`,
		positionSeconds, id,
	)
	if err != nil {
		return fmt.Errorf("updating library playback position: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateDurationAndSize is used after accepting a trim — the file on disk
// changed size/length outside the normal download/import/metadata-edit
// paths, so it's kept as its own narrow update rather than folded into
// UpdateMetadata.
func (r *LibraryRepo) UpdateDurationAndSize(ctx context.Context, id int64, durationSeconds int, fileSizeBytes int64) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET duration = ?, file_size_bytes = ? WHERE id = ?`,
		durationSeconds, fileSizeBytes, id,
	)
	if err != nil {
		return fmt.Errorf("updating library duration/size: %w", err)
	}
	return checkRowsAffected(res)
}

// ApplyRedownloadParams is ApplyRedownload's input. Filename/Path/
// FileSizeBytes/OriginalURL/VideoID are always overwritten — the file
// genuinely changed, and the URL/VideoID are identifiers tied to whatever
// source the redownload actually came from, not optional content. The rest
// are nil-able "leave alone unless overwriting" fields, matching
// UpdateMetadata's existing COALESCE idiom — the caller resolves which are
// nil from the redownload's chosen overwrite-field set.
type ApplyRedownloadParams struct {
	Filename      string
	Path          string
	FileSizeBytes int64
	OriginalURL   string
	VideoID       string
	Duration      *int
	Resolution    *string
	Title         *string
	Uploader      *string
	Description   *string
}

// ApplyRedownload updates an existing library item in place after a
// redownload — the completion path used instead of Create when the
// download's TargetLibraryItemID is set (see queue/manager.go's
// completeRedownload). Deliberately never touches tags, artist, year,
// season/sequence number, generate_nfo, or thumbnail (thumbnail is handled
// by UpdateThumbnail/UpdateThumbnailTiers separately, only when checked).
// status is unconditionally set to 'completed' — a successful redownload
// always means a real file now exists, including the ghost-item-fill-in
// case (see ClearFile, the inverse operation).
func (r *LibraryRepo) ApplyRedownload(ctx context.Context, id int64, p ApplyRedownloadParams) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library
		SET filename = ?, path = ?, file_size_bytes = ?, original_url = ?, video_id = ?, status = 'completed',
		    duration = COALESCE(?, duration), resolution = COALESCE(?, resolution),
		    title = COALESCE(?, title), uploader = COALESCE(?, uploader), description = COALESCE(?, description)
		WHERE id = ?`,
		p.Filename, p.Path, p.FileSizeBytes, p.OriginalURL, p.VideoID,
		p.Duration, p.Resolution, p.Title, p.Uploader, p.Description, id,
	)
	if err != nil {
		return fmt.Errorf("applying redownload: %w", err)
	}
	return checkRowsAffected(res)
}

// ClearFile detaches an item's media file — used both by the "delete file
// only" action on a real item and, structurally, produces the same state a
// ghost item is created in directly (see ApplyRedownload, the inverse
// operation, for filling one back in). filename/path go back to "" (the
// same empty-string sentinel a freshly-created ghost item uses — the
// library.filename/path columns are NOT NULL but otherwise unconstrained,
// so this needs no schema change) and status flips to 'ghost'. When
// clearThumbnail is true, the thumbnail fields are cleared too; otherwise
// they're left untouched so the item keeps showing its existing thumbnail.
func (r *LibraryRepo) ClearFile(ctx context.Context, id int64, clearThumbnail bool) error {
	query := `UPDATE library SET filename = '', path = '', file_size_bytes = NULL, status = 'ghost'`
	if clearThumbnail {
		query += `, thumbnail = NULL, thumbnail_small_path = NULL, thumbnail_medium_path = NULL`
	}
	query += ` WHERE id = ?`

	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("clearing library item file: %w", err)
	}
	return checkRowsAffected(res)
}

// ClearThumbnail wipes just an item's thumbnail fields — the raw sidecar
// path and both derivative tiers — leaving filename/path/status (and
// therefore the media file itself) untouched. The counterpart to
// writeThumbnailAndRespond (thumbnail_handler.go), which writes all three
// fields whenever a thumbnail is (re)generated.
func (r *LibraryRepo) ClearThumbnail(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE library SET thumbnail = NULL, thumbnail_small_path = NULL, thumbnail_medium_path = NULL, thumbnail_width = NULL, thumbnail_height = NULL WHERE id = ?`,
		id,
	)
	if err != nil {
		return fmt.Errorf("clearing library item thumbnail: %w", err)
	}
	return checkRowsAffected(res)
}

// DistinctYears returns every distinct release_year present in the library,
// descending — backs the year filter dropdown, which needs every possible
// value regardless of whatever search/filter/page is currently active.
func (r *LibraryRepo) DistinctYears(ctx context.Context) ([]int, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT DISTINCT release_year FROM library WHERE release_year IS NOT NULL ORDER BY release_year DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing distinct years: %w", err)
	}
	defer rows.Close()

	out := []int{}
	for rows.Next() {
		var y int
		if err := rows.Scan(&y); err != nil {
			return nil, fmt.Errorf("scanning year: %w", err)
		}
		out = append(out, y)
	}
	return out, rows.Err()
}

// LibraryFileRef is the minimal per-item info a missing-file scan needs —
// enough to check disk and report back which title was affected, without
// loading a full LibraryItem for every row.
type LibraryFileRef struct {
	ID    int64
	Title string
	Path  string
}

// ListNonGhostFiles returns id/title/path for every item that currently
// claims to have a file — the working set for the missing-file scan
// (ScanMissingLibraryFiles). Ghosts are excluded since they have no file by
// definition, not because one might be missing.
func (r *LibraryRepo) ListNonGhostFiles(ctx context.Context) ([]LibraryFileRef, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, title, path FROM library WHERE status != 'ghost' AND path != ''`)
	if err != nil {
		return nil, fmt.Errorf("listing library files: %w", err)
	}
	defer rows.Close()

	out := []LibraryFileRef{}
	for rows.Next() {
		var ref LibraryFileRef
		if err := rows.Scan(&ref.ID, &ref.Title, &ref.Path); err != nil {
			return nil, fmt.Errorf("scanning library file ref: %w", err)
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// ListPaths returns the set of relative media paths already tracked in the
// library table, for the import scanner to skip on disk.
func (r *LibraryRepo) ListPaths(ctx context.Context) (map[string]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT path FROM library`)
	if err != nil {
		return nil, fmt.Errorf("listing library paths: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, fmt.Errorf("scanning library path: %w", err)
		}
		out[p] = true
	}
	return out, rows.Err()
}

// Stats returns dashboard counts for the library: video/audio split and
// total storage used. Video/audio is inferred per row: prefer the
// originating download's download_type when the item came from a real
// download (LEFT JOIN downloads), falling back to "has a resolution ->
// video, else audio" for imported files with no linked download.
func (r *LibraryRepo) Stats(ctx context.Context) (videoCount, audioCount, imageCount, videoGhostCount, audioGhostCount, imageGhostCount int, totalBytes int64, err error) {
	row := r.db.QueryRowContext(ctx, `
		WITH typed AS (
			SELECT
				l.status,
				l.file_size_bytes,
				COALESCE(l.media_type, d.download_type, CASE WHEN l.resolution IS NOT NULL THEN 'video' ELSE 'audio' END) AS media_type
			FROM library l
			LEFT JOIN downloads d ON d.id = l.download_id
		)
		SELECT
			COALESCE(SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN media_type = 'audio' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN media_type = 'video' AND status = 'ghost' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN media_type = 'audio' AND status = 'ghost' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN media_type = 'image' AND status = 'ghost' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(file_size_bytes), 0)
		FROM typed`,
	)
	if err = row.Scan(&videoCount, &audioCount, &imageCount, &videoGhostCount, &audioGhostCount, &imageGhostCount, &totalBytes); err != nil {
		return 0, 0, 0, 0, 0, 0, 0, fmt.Errorf("computing library stats: %w", err)
	}
	return videoCount, audioCount, imageCount, videoGhostCount, audioGhostCount, imageGhostCount, totalBytes, nil
}

// LibraryGrowthPoint is one calendar day's new-item tally for the
// dashboard's growth chart.
type LibraryGrowthPoint struct {
	Date  string
	Count int
}

// GrowthByDay returns one row per calendar day with at least one library
// item, oldest first, using idx_library_downloaded_at. No date-range limit —
// per-day granularity keeps this small even for a library with years of
// history. The dashboard handler turns this into a running cumulative total.
func (r *LibraryRepo) GrowthByDay(ctx context.Context) ([]LibraryGrowthPoint, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT date(downloaded_at), COUNT(*)
		FROM library
		GROUP BY date(downloaded_at)
		ORDER BY date(downloaded_at)`,
	)
	if err != nil {
		return nil, fmt.Errorf("querying library growth: %w", err)
	}
	defer rows.Close()

	var out []LibraryGrowthPoint
	for rows.Next() {
		var p LibraryGrowthPoint
		if err := rows.Scan(&p.Date, &p.Count); err != nil {
			return nil, fmt.Errorf("scanning library growth row: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ResolutionStepCount is one standard resolution step's item tally for the
// dashboard's resolution-breakdown chart.
type ResolutionStepCount struct {
	Step  int
	Count int
}

// CountByResolutionStep groups every library item with a parseable
// "WIDTHxHEIGHT" resolution into the nearest of ResolutionSteps (by absolute
// difference in height, ties broken toward the lower step) and returns one
// row per step that has at least one item, in ResolutionSteps order. Items
// with no resolution (audio-only, or unparsed) are excluded rather than
// bucketed, since there's no meaningful step for them.
func (r *LibraryRepo) CountByResolutionStep(ctx context.Context) ([]ResolutionStepCount, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT resolution, COUNT(*)
		FROM library
		WHERE resolution IS NOT NULL AND resolution LIKE '%x%'
		GROUP BY resolution`,
	)
	if err != nil {
		return nil, fmt.Errorf("querying resolution breakdown: %w", err)
	}
	defer rows.Close()

	counts := make(map[int]int, len(ResolutionSteps))
	for rows.Next() {
		var resolution string
		var n int
		if err := rows.Scan(&resolution, &n); err != nil {
			return nil, fmt.Errorf("scanning resolution breakdown row: %w", err)
		}
		idx := strings.LastIndex(resolution, "x")
		if idx < 0 || idx == len(resolution)-1 {
			continue
		}
		height, err := strconv.Atoi(resolution[idx+1:])
		if err != nil || height <= 0 {
			continue
		}
		counts[nearestResolutionStep(height)] += n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]ResolutionStepCount, 0, len(ResolutionSteps))
	for _, step := range ResolutionSteps {
		if n, ok := counts[step]; ok {
			out = append(out, ResolutionStepCount{Step: step, Count: n})
		}
	}
	return out, nil
}

func nearestResolutionStep(height int) int {
	best := ResolutionSteps[0]
	bestDiff := abs(height - best)
	for _, step := range ResolutionSteps[1:] {
		diff := abs(height - step)
		if diff < bestDiff {
			best = step
			bestDiff = diff
		}
	}
	return best
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func checkRowsAffected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

const librarySelectPrefix = `
	SELECT l.id, l.download_id, l.title, l.filename, l.path, l.collection_id, c.name, l.folder, l.original_url, l.video_id,
	       l.uploader, l.duration, l.resolution, l.media_type, l.thumbnail, l.thumbnail_small_path, l.thumbnail_medium_path, l.thumbnail_width, l.thumbnail_height, l.description, l.artist_id, a.name, l.release_year, l.sequence_number, l.season_number, l.generate_nfo, l.downloaded_at, l.status, l.file_size_bytes,
	       l.playback_position_seconds, l.last_watched_at`

const libraryFromClause = `
	FROM library l
	LEFT JOIN collections c ON c.id = l.collection_id
	LEFT JOIN artists a ON a.id = l.artist_id`

const librarySelectColumns = librarySelectPrefix + libraryFromClause

func scanLibraryItem(row rowScanner) (*models.LibraryItem, error) {
	var item models.LibraryItem
	var downloadedAt string
	var lastWatchedAt sql.NullString

	err := row.Scan(
		&item.ID, &item.DownloadID, &item.Title, &item.Filename, &item.Path, &item.CollectionID, &item.CollectionName, &item.Folder,
		&item.OriginalURL, &item.VideoID, &item.Uploader, &item.Duration, &item.Resolution, &item.MediaType, &item.Thumbnail, &item.ThumbnailSmallPath, &item.ThumbnailMediumPath, &item.ThumbnailWidth, &item.ThumbnailHeight,
		&item.Description, &item.ArtistID, &item.ArtistName, &item.ReleaseYear, &item.SequenceNumber, &item.SeasonNumber, &item.GenerateNFO, &downloadedAt, &item.Status, &item.FileSizeBytes,
		&item.PlaybackPositionSeconds, &lastWatchedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning library item: %w", err)
	}

	item.DownloadedAt, err = parseSQLiteTime(downloadedAt)
	if err != nil {
		return nil, err
	}
	if lastWatchedAt.Valid {
		t, err := parseSQLiteTime(lastWatchedAt.String)
		if err != nil {
			return nil, err
		}
		item.LastWatchedAt = &t
	}
	return &item, nil
}
