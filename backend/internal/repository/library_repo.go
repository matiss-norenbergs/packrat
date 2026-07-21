package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"packrat/backend/internal/models"
)

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
		                      video_id, uploader, duration, resolution, thumbnail, description, artist_id, release_year,
		                      sequence_number, season_number, generate_nfo, status, file_size_bytes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.DownloadID, item.Title, item.Filename, item.Path, item.CollectionID, item.Folder, item.OriginalURL,
		item.VideoID, item.Uploader, item.Duration, item.Resolution, item.Thumbnail, item.Description, item.ArtistID, item.ReleaseYear,
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
	Year               *int     // exact match on release_year; nil = no filter
	Tags               []string // AND semantics — an item must have every tag
	SortKey            string   // downloadedAt|title|filename|year|duration|sequenceNumber
	SortDir            string   // asc|desc
	Page               int      // 1-based; 0 means "no pagination", return every matching row
	PageSize           int      // only used when Page > 0; defaults to 48 if <= 0
}

var librarySortColumns = map[string]string{
	"downloadedAt":   "l.downloaded_at",
	"title":          "l.title",
	"filename":       "l.filename",
	"year":           "l.release_year",
	"duration":       "l.duration",
	"sequenceNumber": "l.sequence_number",
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
	if q.Year != nil {
		conditions = append(conditions, `l.release_year = ?`)
		args = append(args, *q.Year)
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

	sortCol, ok := librarySortColumns[q.SortKey]
	if !ok {
		sortCol = "l.downloaded_at"
	}
	sortDir := "DESC"
	if q.SortDir == "asc" {
		sortDir = "ASC"
	}
	// "<col> IS NULL" sorts ASC (0 before 1), so nulls always land last
	// regardless of the requested direction — matches the frontend's old
	// compareValues behavior.
	orderBy := fmt.Sprintf(" ORDER BY %s IS NULL, %s %s", sortCol, sortCol, sortDir)

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
func (r *LibraryRepo) Stats(ctx context.Context) (videoCount, audioCount int, totalBytes int64, err error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN COALESCE(d.download_type, CASE WHEN l.resolution IS NOT NULL THEN 'video' ELSE 'audio' END) = 'video' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN COALESCE(d.download_type, CASE WHEN l.resolution IS NOT NULL THEN 'video' ELSE 'audio' END) = 'audio' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(l.file_size_bytes), 0)
		FROM library l
		LEFT JOIN downloads d ON d.id = l.download_id`,
	)
	if err = row.Scan(&videoCount, &audioCount, &totalBytes); err != nil {
		return 0, 0, 0, fmt.Errorf("computing library stats: %w", err)
	}
	return videoCount, audioCount, totalBytes, nil
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
	       l.uploader, l.duration, l.resolution, l.thumbnail, l.description, l.artist_id, a.name, l.release_year, l.sequence_number, l.season_number, l.generate_nfo, l.downloaded_at, l.status, l.file_size_bytes,
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
		&item.OriginalURL, &item.VideoID, &item.Uploader, &item.Duration, &item.Resolution, &item.Thumbnail,
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
