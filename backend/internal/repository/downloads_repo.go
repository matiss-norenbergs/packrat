package repository

import (
	"context"
	"database/sql"
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
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO downloads (url, collection_id, folder, filename, download_type, quality, audio_format, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		d.URL, d.CollectionID, d.Folder, d.Filename, d.DownloadType, d.Quality, d.AudioFormat, d.Status,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting download: %w", err)
	}
	return res.LastInsertId()
}

func (r *DownloadsRepo) Get(ctx context.Context, id int64) (*models.Download, error) {
	row := r.db.QueryRowContext(ctx, downloadSelectColumns+` WHERE id = ?`, id)
	d, err := scanDownload(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return d, err
}

func (r *DownloadsRepo) List(ctx context.Context) ([]models.Download, error) {
	rows, err := r.db.QueryContext(ctx, downloadSelectColumns+` ORDER BY created_at DESC`)
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

func (r *DownloadsRepo) MarkCompleted(ctx context.Context, id int64, exitCode int, resolution *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE downloads
		SET status = ?, exit_code = ?, resolution = COALESCE(?, resolution), completed_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ?`,
		models.StatusCompleted, exitCode, resolution, id,
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

// MarkInterruptedIfActive is run once at startup. Any download still in an
// "active" status (queued/fetching_metadata/downloading/processing) when the
// process starts was orphaned by a crash or restart, since no worker is
// running yet to own it. It is marked interrupted rather than silently
// resumed, per the Crash/Restart Recovery requirement.
func (r *DownloadsRepo) MarkInterruptedIfActive(ctx context.Context) (int64, error) {
	statuses := models.ActiveStatuses()
	placeholders := make([]string, len(statuses))
	args := make([]any, 0, len(statuses)+1)
	args = append(args, models.StatusInterrupted)
	for i, s := range statuses {
		placeholders[i] = "?"
		args = append(args, s)
	}
	query := fmt.Sprintf(`UPDATE downloads SET status = ?, updated_at = datetime('now') WHERE status IN (%s)`,
		strings.Join(placeholders, ","))
	res, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("marking interrupted downloads: %w", err)
	}
	return res.RowsAffected()
}

const downloadSelectColumns = `
	SELECT id, url, video_id, collection_id, folder, filename, download_type, quality, audio_format,
	       status, title, uploader, duration, resolution, thumbnail, error_message, ytdlp_command,
	       exit_code, stdout_tail, stderr_tail, retry_count, created_at, updated_at, completed_at
	FROM downloads`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanDownload(row rowScanner) (*models.Download, error) {
	var d models.Download
	var createdAt, updatedAt string
	var completedAt sql.NullString

	err := row.Scan(
		&d.ID, &d.URL, &d.VideoID, &d.CollectionID, &d.Folder, &d.Filename, &d.DownloadType, &d.Quality, &d.AudioFormat,
		&d.Status, &d.Title, &d.Uploader, &d.Duration, &d.Resolution, &d.Thumbnail, &d.ErrorMessage, &d.YtDlpCommand,
		&d.ExitCode, &d.StdoutTail, &d.StderrTail, &d.RetryCount, &createdAt, &updatedAt, &completedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning download: %w", err)
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
