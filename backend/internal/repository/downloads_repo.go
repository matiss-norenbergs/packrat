package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"packrat/backend/internal/models"
)

type DownloadsRepo struct {
	db *sql.DB
}

func NewDownloadsRepo(db *sql.DB) *DownloadsRepo {
	return &DownloadsRepo{db: db}
}

func (r *DownloadsRepo) Create(ctx context.Context, d *models.Download) (int64, error) {
	overrideTags, err := encodeStringSlice(d.OverrideTags)
	if err != nil {
		return 0, fmt.Errorf("encoding override tags: %w", err)
	}
	overwriteFields, err := encodeStringSlice(d.OverwriteFields)
	if err != nil {
		return 0, fmt.Errorf("encoding overwrite fields: %w", err)
	}
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO downloads (url, collection_id, folder, filename, download_type, quality, audio_format, status,
		                        override_title, override_artist_id, override_year, override_season_number, override_sequence_number, filename_prefix, filename_template, override_tags, generate_nfo,
		                        target_library_item_id, overwrite_fields, ghost_library_item_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.URL, d.CollectionID, d.Folder, d.Filename, d.DownloadType, d.Quality, d.AudioFormat, d.Status,
		d.OverrideTitle, d.OverrideArtistID, d.OverrideYear, d.OverrideSeasonNumber, d.OverrideSequenceNumber, d.FilenamePrefix, d.FilenameTemplate, overrideTags, d.GenerateNFO,
		d.TargetLibraryItemID, overwriteFields, d.GhostLibraryItemID,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting download: %w", err)
	}
	return res.LastInsertId()
}

// encodeStringSlice/decodeStringSlice marshal a []string to/from a single
// TEXT column as a JSON array — nil (not "[]") when there's nothing to
// store, so a row with nothing set leaves the column NULL. Shared by
// OverrideTags (override_tags) and OverwriteFields (overwrite_fields).
func encodeStringSlice(values []string) (*string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	b, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func decodeStringSlice(raw sql.NullString) ([]string, error) {
	if !raw.Valid || raw.String == "" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw.String), &values); err != nil {
		return nil, fmt.Errorf("decoding string slice column: %w", err)
	}
	return values, nil
}

func (r *DownloadsRepo) Get(ctx context.Context, id int64) (*models.Download, error) {
	row := r.db.QueryRowContext(ctx, downloadSelectColumns+` WHERE d.id = ?`, id)
	d, err := scanDownload(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return d, err
}

// GetByIDs batch-fetches downloads for every id, keyed by id — used by
// backup.BuildLibraryBundle so exporting a library with N items costs one
// query for their originating Download rows, not N.
func (r *DownloadsRepo) GetByIDs(ctx context.Context, ids []int64) (map[int64]*models.Download, error) {
	out := make(map[int64]*models.Download, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	err := inChunks(ids, inChunkSize, func(chunk []int64) error {
		rows, err := r.db.QueryContext(ctx, downloadSelectColumns+` WHERE d.id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return fmt.Errorf("batch-fetching downloads: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			d, err := scanDownload(rows)
			if err != nil {
				return err
			}
			out[d.ID] = d
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// List returns every download, newest first, with every column (including the
// ~8 KB output tails and the yt-dlp command). It scans the whole table, so
// request paths use ListRecent (bounded) or ListLight (the live queue)
// instead; the remaining callers are tests.
func (r *DownloadsRepo) List(ctx context.Context) ([]models.Download, error) {
	return r.listWhere(ctx, downloadSelectColumns+` ORDER BY d.created_at DESC`)
}

// ListRecent returns the newest `limit` downloads, newest first, with every
// column (the Logs view needs the tails and command). Ties on created_at (it
// has one-second resolution) break by id so the page is deterministic. Uses
// idx_downloads_created_at, so the cost follows the limit, not the table.
func (r *DownloadsRepo) ListRecent(ctx context.Context, limit int) ([]models.Download, error) {
	if limit <= 0 {
		return nil, nil
	}
	return r.listWhere(ctx, downloadSelectColumns+` ORDER BY d.created_at DESC, d.id DESC LIMIT ?`, limit)
}

// ListLight is List without the heavy text columns: stdout_tail, stderr_tail
// and ytdlp_command come back as NULL, so scanDownload and every caller work
// unchanged and those fields are simply nil. It backs the live queue
// (GET /api/downloads), whose response uses none of them, and — like List — is
// deliberately unbounded: the queue must never silently truncate.
func (r *DownloadsRepo) ListLight(ctx context.Context) ([]models.Download, error) {
	return r.listWhere(ctx, downloadSelectColumnsLight+` ORDER BY d.created_at DESC`)
}

func (r *DownloadsRepo) listWhere(ctx context.Context, query string, args ...any) ([]models.Download, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listing downloads: %w", err)
	}
	defer rows.Close()

	var out []models.Download
	for rows.Next() {
		d, err := scanDownload(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

func (r *DownloadsRepo) UpdateStatus(ctx context.Context, id int64, status models.DownloadStatus, errMsg *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`,
		status, errMsg, id,
	)
	if err != nil {
		return fmt.Errorf("updating download status: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *DownloadsRepo) UpdateMetadata(ctx context.Context, id int64, videoID, title, uploader *string, duration *int, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET video_id = ?, title = ?, uploader = ?, duration = ?, thumbnail = ?, updated_at = datetime('now')
		WHERE id = ?`,
		videoID, title, uploader, duration, thumbnail, id,
	)
	if err != nil {
		return fmt.Errorf("updating download metadata: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *DownloadsRepo) SetCommand(ctx context.Context, id int64, command string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE downloads SET ytdlp_command = ?, updated_at = datetime('now') WHERE id = ?`, command, id)
	if err != nil {
		return fmt.Errorf("setting download command: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *DownloadsRepo) MarkCompleted(ctx context.Context, id int64, exitCode int, resolution *string, stdoutTail, stderrTail string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET status = ?, exit_code = ?, resolution = COALESCE(?, resolution), stdout_tail = ?, stderr_tail = ?, completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ?`,
		models.StatusCompleted, exitCode, resolution, stdoutTail, stderrTail, id,
	)
	if err != nil {
		return fmt.Errorf("marking download completed: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *DownloadsRepo) MarkFailed(ctx context.Context, id int64, exitCode int, errMsg, stdoutTail, stderrTail string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET status = ?, exit_code = ?, error_message = ?, stdout_tail = ?, stderr_tail = ?, completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ?`,
		models.StatusFailed, exitCode, errMsg, stdoutTail, stderrTail, id,
	)
	if err != nil {
		return fmt.Errorf("marking download failed: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *DownloadsRepo) MarkCancelled(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
		models.StatusCancelled, id,
	)
	if err != nil {
		return fmt.Errorf("marking download cancelled: %w", err)
	}
	return checkRowsAffected(res)
}

// MarkCancelledIfPending cancels a download only while it is still waiting to
// run (queued or fetching_metadata), and reports whether it did. It is the
// conditional form Cancel uses for a download no worker owns: a worker that
// has already moved the row on (or finished it) wins, and the caller reports
// the download as no longer cancellable. MarkCancelled stays unconditional
// because the worker itself records a cancelled run from downloading /
// processing.
func (r *DownloadsRepo) MarkCancelledIfPending(ctx context.Context, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ? AND status IN (?, ?)`,
		models.StatusCancelled, id, models.StatusQueued, models.StatusFetchingMetadata,
	)
	if err != nil {
		return false, fmt.Errorf("marking download cancelled: %w", err)
	}
	return changed(res)
}

// MarkFetchingMetadataIfQueued is the worker's queued -> fetching_metadata
// transition. It changes the row only while it is still `queued` and reports
// whether it did: 0 rows means the download was cancelled (or deleted) after
// the worker loaded it, and the worker must not start it.
func (r *DownloadsRepo) MarkFetchingMetadataIfQueued(ctx context.Context, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`,
		models.StatusFetchingMetadata, id, models.StatusQueued,
	)
	if err != nil {
		return false, fmt.Errorf("starting download: %w", err)
	}
	return changed(res)
}

// changed reports whether an UPDATE touched at least one row.
func changed(res sql.Result) (bool, error) {
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// SetGhostLibraryItem records the library row a download is filling in (see
// models.Download.GhostLibraryItemID).
func (r *DownloadsRepo) SetGhostLibraryItem(ctx context.Context, id, libraryItemID int64) error {
	res, err := r.db.ExecContext(ctx, `UPDATE downloads SET ghost_library_item_id = ?, updated_at = datetime('now') WHERE id = ?`, libraryItemID, id)
	if err != nil {
		return fmt.Errorf("setting download ghost item: %w", err)
	}
	return checkRowsAffected(res)
}

// ActiveDownloadIDsByLibraryItem returns, for each of the given library item
// ids that has a queued/running download (via ghost_library_item_id or
// target_library_item_id), the id of that download. One query for the whole
// batch; items without an active download are absent from the map. If an
// item somehow has several, the newest wins.
func (r *DownloadsRepo) ActiveDownloadIDsByLibraryItem(ctx context.Context, itemIDs []int64) (map[int64]int64, error) {
	out := make(map[int64]int64)
	if len(itemIDs) == 0 {
		return out, nil
	}
	statuses := models.ActiveStatuses()
	statusPH := placeholderList(len(statuses))
	err := inChunks(itemIDs, inChunkSize, func(chunk []int64) error {
		args := make([]any, 0, len(statuses)+2*len(chunk))
		for _, s := range statuses {
			args = append(args, s)
		}
		for i := 0; i < 2; i++ {
			for _, id := range chunk {
				args = append(args, id)
			}
		}
		idPH := placeholderList(len(chunk))
		query := fmt.Sprintf(`
			SELECT id, ghost_library_item_id, target_library_item_id FROM downloads
			WHERE status IN (%s) AND (ghost_library_item_id IN (%s) OR target_library_item_id IN (%s))
			ORDER BY id ASC`, statusPH, idPH, idPH)
		rows, err := r.db.QueryContext(ctx, query, args...)
		if err != nil {
			return fmt.Errorf("looking up active downloads for library items: %w", err)
		}
		defer rows.Close()
		// Per chunk: an item is only ever queried in its own chunk, so its
		// "newest wins" ascending-id overwrite order stays intact.
		wanted := make(map[int64]bool, len(chunk))
		for _, id := range chunk {
			wanted[id] = true
		}
		for rows.Next() {
			var id int64
			var ghost, target sql.NullInt64
			if err := rows.Scan(&id, &ghost, &target); err != nil {
				return fmt.Errorf("scanning active download: %w", err)
			}
			for _, lib := range []sql.NullInt64{ghost, target} {
				if lib.Valid && wanted[lib.Int64] {
					out[lib.Int64] = id // ascending id order: the newest overwrites
				}
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteOlderThan removes every download log entry created before cutoff,
// returning how many rows were deleted — the implementation behind the
// configurable retention sweep (see cleanupDownloadLog in cmd/server/main.go)
// and the "clear all" action (called with cutoff = time.Now()). A row still
// in an active status (queued/fetching_metadata/downloading/processing) is
// never deleted regardless of age, mirroring DownloadsRepo.DeleteByIDs'
// active-status guard — this is a log-pruning operation, not a queue-cancellation one.
// created_at is stored as SQLite's datetime('now') text (UTC, "YYYY-MM-DD
// HH:MM:SS"), which sorts and compares correctly as a plain string, so
// cutoff is formatted the same way rather than relying on SQLite's own date
// functions.
func (r *DownloadsRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	statuses := models.ActiveStatuses()
	placeholders := make([]string, len(statuses))
	args := make([]any, 0, len(statuses)+1)
	args = append(args, cutoff.UTC().Format("2006-01-02 15:04:05"))
	for i, s := range statuses {
		placeholders[i] = "?"
		args = append(args, s)
	}
	query := fmt.Sprintf(`DELETE FROM downloads WHERE created_at < ? AND status NOT IN (%s)`, strings.Join(placeholders, ", "))
	res, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("deleting old download log entries: %w", err)
	}
	return res.RowsAffected()
}

// MarkInterruptedIfActive is run once at startup. Any download still in an
// "active" status (queued/fetching_metadata/downloading/processing) when the
// process starts was orphaned by a crash or restart, since no worker is
// running yet to own it. It is marked interrupted rather than silently
// resumed, per the Crash/Restart Recovery requirement. Returns the affected
// rows (not just a count) so the caller can also record a History entry for
// each one.
func (r *DownloadsRepo) MarkInterruptedIfActive(ctx context.Context) ([]models.Download, error) {
	statuses := models.ActiveStatuses()
	placeholders := make([]string, len(statuses))
	args := make([]any, len(statuses))
	for i, s := range statuses {
		placeholders[i] = "?"
		args[i] = s
	}

	// Select and update in one transaction, so a download that finishes between
	// the two is not reported (and overwritten) as interrupted.
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("marking interrupted downloads: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, downloadSelectColumns+fmt.Sprintf(` WHERE d.status IN (%s)`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return nil, fmt.Errorf("finding active downloads: %w", err)
	}
	var affected []models.Download
	for rows.Next() {
		d, err := scanDownload(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		affected = append(affected, *d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(affected) == 0 {
		return nil, nil
	}

	affectedIDs := make([]int64, len(affected))
	for i, d := range affected {
		affectedIDs[i] = d.ID
	}
	err = inChunks(affectedIDs, inChunkSize, func(chunk []int64) error {
		query := `UPDATE downloads SET status = ?, updated_at = datetime('now') WHERE id IN (` + placeholderList(len(chunk)) + `)`
		args := append([]any{models.StatusInterrupted}, anySlice(chunk)...)
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return fmt.Errorf("marking interrupted downloads: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("marking interrupted downloads: %w", err)
	}
	return affected, nil
}

// Stats returns dashboard counts: active is anything a worker is currently
// handling (fetching_metadata/downloading/processing — status "queued"
// itself is counted separately since nothing is actively working on it
// yet); completedToday uses date(completed_at) = date('now'), a UTC-day
// boundary matching every other timestamp in this app.
func (r *DownloadsRepo) Stats(ctx context.Context) (active, queued, completedToday int, err error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN status IN (?, ?, ?) THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = ? AND date(completed_at) = date('now') THEN 1 ELSE 0 END), 0)
		FROM downloads`,
		models.StatusFetchingMetadata, models.StatusDownloading, models.StatusProcessing,
		models.StatusQueued,
		models.StatusCompleted,
	)
	if err = row.Scan(&active, &queued, &completedToday); err != nil {
		return 0, 0, 0, fmt.Errorf("computing download stats: %w", err)
	}
	return active, queued, completedToday, nil
}

const downloadSelectColumns = `
	SELECT d.id, d.url, d.video_id, d.collection_id, c.name, d.folder, d.filename, d.download_type, d.quality, d.audio_format,
	       d.status, d.title, d.uploader, d.duration, d.resolution, d.thumbnail, d.error_message, d.ytdlp_command,
	       d.exit_code, d.stdout_tail, d.stderr_tail, d.retry_count, d.created_at, d.updated_at, d.completed_at,
	       d.override_title, d.override_artist_id, d.override_year, d.override_season_number, d.override_sequence_number, d.filename_prefix, d.filename_template, d.override_tags, d.generate_nfo,
	       d.target_library_item_id, d.overwrite_fields, d.ghost_library_item_id
	FROM downloads d
	LEFT JOIN collections c ON c.id = d.collection_id`

// downloadSelectColumnsLight is downloadSelectColumns with the three large
// text columns replaced by NULL (same column order, so scanDownload works).
var downloadSelectColumnsLight = strings.NewReplacer(
	"d.ytdlp_command", "NULL",
	"d.stdout_tail", "NULL",
	"d.stderr_tail", "NULL",
).Replace(downloadSelectColumns)

type rowScanner interface {
	Scan(dest ...any) error
}

func scanDownload(row rowScanner) (*models.Download, error) {
	var d models.Download
	var createdAt, updatedAt string
	var completedAt sql.NullString
	var overrideTags, overwriteFields sql.NullString

	err := row.Scan(
		&d.ID, &d.URL, &d.VideoID, &d.CollectionID, &d.CollectionName, &d.Folder, &d.Filename, &d.DownloadType, &d.Quality, &d.AudioFormat,
		&d.Status, &d.Title, &d.Uploader, &d.Duration, &d.Resolution, &d.Thumbnail, &d.ErrorMessage, &d.YtDlpCommand,
		&d.ExitCode, &d.StdoutTail, &d.StderrTail, &d.RetryCount, &createdAt, &updatedAt, &completedAt,
		&d.OverrideTitle, &d.OverrideArtistID, &d.OverrideYear, &d.OverrideSeasonNumber, &d.OverrideSequenceNumber, &d.FilenamePrefix, &d.FilenameTemplate, &overrideTags, &d.GenerateNFO,
		&d.TargetLibraryItemID, &overwriteFields, &d.GhostLibraryItemID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning download: %w", err)
	}

	d.OverrideTags, err = decodeStringSlice(overrideTags)
	if err != nil {
		return nil, err
	}
	d.OverwriteFields, err = decodeStringSlice(overwriteFields)
	if err != nil {
		return nil, err
	}

	d.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	d.UpdatedAt, err = parseSQLiteTime(updatedAt)
	if err != nil {
		return nil, err
	}
	if completedAt.Valid {
		t, err := parseSQLiteTime(completedAt.String)
		if err != nil {
			return nil, err
		}
		d.CompletedAt = &t
	}

	return &d, nil
}

func parseSQLiteTime(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02 15:04:05", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parsing sqlite timestamp %q: %w", s, err)
	}
	return t, nil
}
