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
	overrideTags, err := encodeOverrideTags(d.OverrideTags)
	if err != nil {
		return 0, fmt.Errorf("encoding override tags: %w", err)
	}
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO downloads (url, collection_id, folder, filename, download_type, quality, audio_format, status,
		                        override_title, override_artist_id, override_year, override_season_number, override_sequence_number, filename_prefix, override_tags, generate_nfo)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		d.URL, d.CollectionID, d.Folder, d.Filename, d.DownloadType, d.Quality, d.AudioFormat, d.Status,
		d.OverrideTitle, d.OverrideArtistID, d.OverrideYear, d.OverrideSeasonNumber, d.OverrideSequenceNumber, d.FilenamePrefix, overrideTags, d.GenerateNFO,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting download: %w", err)
	}
	return res.LastInsertId()
}

// encodeOverrideTags/decodeOverrideTags marshal OverrideTags to/from the
// single override_tags TEXT column — nil (not "[]") when there's nothing to
// store, so a plain download with no tag override leaves the column NULL.
func encodeOverrideTags(tags []string) (*string, error) {
	if len(tags) == 0 {
		return nil, nil
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func decodeOverrideTags(raw sql.NullString) ([]string, error) {
	if !raw.Valid || raw.String == "" {
		return nil, nil
	}
	var tags []string
	if err := json.Unmarshal([]byte(raw.String), &tags); err != nil {
		return nil, fmt.Errorf("decoding override tags: %w", err)
	}
	return tags, nil
}

func (r *DownloadsRepo) Get(ctx context.Context, id int64) (*models.Download, error) {
	row := r.db.QueryRowContext(ctx, downloadSelectColumns+` WHERE d.id = ?`, id)
	d, err := scanDownload(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return d, err
}

func (r *DownloadsRepo) List(ctx context.Context) ([]models.Download, error) {
	rows, err := r.db.QueryContext(ctx, downloadSelectColumns+` ORDER BY d.created_at DESC`)
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
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`,
		status, errMsg, id,
	)
	return err
}

func (r *DownloadsRepo) UpdateMetadata(ctx context.Context, id int64, videoID, title, uploader *string, duration *int, thumbnail *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET video_id = ?, title = ?, uploader = ?, duration = ?, thumbnail = ?, updated_at = datetime('now')
		WHERE id = ?`,
		videoID, title, uploader, duration, thumbnail, id,
	)
	return err
}

func (r *DownloadsRepo) SetCommand(ctx context.Context, id int64, command string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE downloads SET ytdlp_command = ?, updated_at = datetime('now') WHERE id = ?`, command, id)
	return err
}

func (r *DownloadsRepo) MarkCompleted(ctx context.Context, id int64, exitCode int, resolution *string, stdoutTail, stderrTail string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET status = ?, exit_code = ?, resolution = COALESCE(?, resolution), stdout_tail = ?, stderr_tail = ?, completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ?`,
		models.StatusCompleted, exitCode, resolution, stdoutTail, stderrTail, id,
	)
	return err
}

func (r *DownloadsRepo) MarkFailed(ctx context.Context, id int64, exitCode int, errMsg, stdoutTail, stderrTail string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET status = ?, exit_code = ?, error_message = ?, stdout_tail = ?, stderr_tail = ?, completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ?`,
		models.StatusFailed, exitCode, errMsg, stdoutTail, stderrTail, id,
	)
	return err
}

func (r *DownloadsRepo) MarkCancelled(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
		models.StatusCancelled, id,
	)
	return err
}

// Delete removes a download's history row. Safe to call even for a download
// that has a completed library item — library.download_id is
// ON DELETE SET NULL, so the library item just loses its back-link, it is
// never itself deleted.
func (r *DownloadsRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM downloads WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting download: %w", err)
	}
	return checkRowsAffected(res)
}

// DeleteOlderThan removes every download log entry created before cutoff,
// returning how many rows were deleted — the implementation behind the
// configurable retention sweep (see cleanupDownloadLog in cmd/server/main.go)
// and the "clear all" action (called with cutoff = time.Now()). A row still
// in an active status (queued/fetching_metadata/downloading/processing) is
// never deleted regardless of age, mirroring DeleteDownload's single-item
// guard — this is a log-pruning operation, not a queue-cancellation one.
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

	rows, err := r.db.QueryContext(ctx, downloadSelectColumns+fmt.Sprintf(` WHERE d.status IN (%s)`, strings.Join(placeholders, ",")), args...)
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

	idPlaceholders := make([]string, len(affected))
	updateArgs := make([]any, 0, len(affected)+1)
	updateArgs = append(updateArgs, models.StatusInterrupted)
	for i, d := range affected {
		idPlaceholders[i] = "?"
		updateArgs = append(updateArgs, d.ID)
	}
	query := fmt.Sprintf(`UPDATE downloads SET status = ?, updated_at = datetime('now') WHERE id IN (%s)`,
		strings.Join(idPlaceholders, ","))
	if _, err := r.db.ExecContext(ctx, query, updateArgs...); err != nil {
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
	       d.override_title, d.override_artist_id, d.override_year, d.override_season_number, d.override_sequence_number, d.filename_prefix, d.override_tags, d.generate_nfo
	FROM downloads d
	LEFT JOIN collections c ON c.id = d.collection_id`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanDownload(row rowScanner) (*models.Download, error) {
	var d models.Download
	var createdAt, updatedAt string
	var completedAt sql.NullString
	var overrideTags sql.NullString

	err := row.Scan(
		&d.ID, &d.URL, &d.VideoID, &d.CollectionID, &d.CollectionName, &d.Folder, &d.Filename, &d.DownloadType, &d.Quality, &d.AudioFormat,
		&d.Status, &d.Title, &d.Uploader, &d.Duration, &d.Resolution, &d.Thumbnail, &d.ErrorMessage, &d.YtDlpCommand,
		&d.ExitCode, &d.StdoutTail, &d.StderrTail, &d.RetryCount, &createdAt, &updatedAt, &completedAt,
		&d.OverrideTitle, &d.OverrideArtistID, &d.OverrideYear, &d.OverrideSeasonNumber, &d.OverrideSequenceNumber, &d.FilenamePrefix, &overrideTags, &d.GenerateNFO,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning download: %w", err)
	}

	d.OverrideTags, err = decodeOverrideTags(overrideTags)
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
