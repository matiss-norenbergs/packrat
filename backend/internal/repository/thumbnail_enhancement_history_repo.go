package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"packrat/backend/internal/models"
)

type ThumbnailEnhancementHistoryRepo struct {
	db *sql.DB
}

func NewThumbnailEnhancementHistoryRepo(db *sql.DB) *ThumbnailEnhancementHistoryRepo {
	return &ThumbnailEnhancementHistoryRepo{db: db}
}

// Create records one attempted item — called for both success and failure,
// so a connection/decode/write failure is just as visible as a success is.
func (r *ThumbnailEnhancementHistoryRepo) Create(ctx context.Context, e *models.ThumbnailEnhancementHistoryEntry) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO thumbnail_enhancement_history (
			library_item_id, item_title, status, original_width, original_height,
			enhanced_width, enhanced_height, original_size_bytes, enhanced_size_bytes, error, trigger_type
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.LibraryItemID, e.ItemTitle, e.Status, e.OriginalWidth, e.OriginalHeight,
		e.EnhancedWidth, e.EnhancedHeight, e.OriginalSizeBytes, e.EnhancedSizeBytes, e.Error, e.TriggerType,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting thumbnail enhancement history entry: %w", err)
	}
	return res.LastInsertId()
}

// ThumbnailEnhancementHistoryQuery describes a filtered, searched,
// optionally-paginated fetch of the history log — mirrors LibraryQuery's
// shape/pattern (backend/internal/repository/library_repo.go).
type ThumbnailEnhancementHistoryQuery struct {
	Search      string // substring match against item_title; empty = no filter
	Status      string // exact match on status ("success"|"failed"); empty = no filter
	TriggerType string // exact match on trigger_type ("manual"|"scheduled"|"auto"); empty = no filter
	Page        int    // 1-based; 0 means "no pagination", return every matching row
	PageSize    int    // only used when Page > 0; defaults to 25 if <= 0
}

// Query builds one parameterized statement covering search + filters +
// optional pagination, most recent first, returning the matching page (or
// everything, when Page is 0) along with the total match count.
func (r *ThumbnailEnhancementHistoryRepo) Query(ctx context.Context, q ThumbnailEnhancementHistoryQuery) ([]models.ThumbnailEnhancementHistoryEntry, int, error) {
	var conditions []string
	var args []any

	if q.Search != "" {
		conditions = append(conditions, `item_title LIKE ? ESCAPE '\'`)
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q.Search)
		args = append(args, "%"+escaped+"%")
	}
	if q.Status != "" {
		conditions = append(conditions, `status = ?`)
		args = append(args, q.Status)
	}
	if q.TriggerType != "" {
		conditions = append(conditions, `trigger_type = ?`)
		args = append(args, q.TriggerType)
	}

	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	countQuery := `SELECT COUNT(*) FROM thumbnail_enhancement_history` + where
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting thumbnail enhancement history: %w", err)
	}

	listQuery := `
		SELECT id, library_item_id, item_title, status, original_width, original_height,
			enhanced_width, enhanced_height, original_size_bytes, enhanced_size_bytes, error, created_at, reverted_at, trigger_type
		FROM thumbnail_enhancement_history` + where + ` ORDER BY created_at DESC`
	listArgs := append([]any{}, args...)
	if q.Page > 0 {
		pageSize := q.PageSize
		if pageSize <= 0 {
			pageSize = 25
		}
		listQuery += " LIMIT ? OFFSET ?"
		listArgs = append(listArgs, pageSize, (q.Page-1)*pageSize)
	}

	rows, err := r.db.QueryContext(ctx, listQuery, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("querying thumbnail enhancement history: %w", err)
	}
	defer rows.Close()

	var out []models.ThumbnailEnhancementHistoryEntry
	for rows.Next() {
		var e models.ThumbnailEnhancementHistoryEntry
		var createdAt string
		var revertedAt sql.NullString
		if err := rows.Scan(
			&e.ID, &e.LibraryItemID, &e.ItemTitle, &e.Status, &e.OriginalWidth, &e.OriginalHeight,
			&e.EnhancedWidth, &e.EnhancedHeight, &e.OriginalSizeBytes, &e.EnhancedSizeBytes, &e.Error, &createdAt, &revertedAt, &e.TriggerType,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning thumbnail enhancement history entry: %w", err)
		}
		e.CreatedAt, err = parseSQLiteTime(createdAt)
		if err != nil {
			return nil, 0, err
		}
		if revertedAt.Valid {
			t, err := parseSQLiteTime(revertedAt.String)
			if err != nil {
				return nil, 0, err
			}
			e.RevertedAt = &t
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// RecentlyFailedItemIDs returns, for every library item whose most recent
// history row is a failure created at or after since, that failure's
// timestamp — used by findEligible to skip (automatic triggers) or just
// annotate (manual triggers) an item still inside its failure cooldown.
// Only the latest attempt matters: an item that failed and was then
// successfully retried is not "recently failed" even if an old failure row
// is still within the window.
func (r *ThumbnailEnhancementHistoryRepo) RecentlyFailedItemIDs(ctx context.Context, since time.Time) (map[int64]time.Time, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT h.library_item_id, h.created_at
		FROM thumbnail_enhancement_history h
		JOIN (
			SELECT library_item_id, MAX(created_at) AS max_created_at
			FROM thumbnail_enhancement_history
			WHERE library_item_id IS NOT NULL
			GROUP BY library_item_id
		) latest ON latest.library_item_id = h.library_item_id AND latest.max_created_at = h.created_at
		WHERE h.status = 'failed' AND h.created_at >= ?`,
		since.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return nil, fmt.Errorf("querying recently-failed thumbnail enhancement items: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]time.Time)
	for rows.Next() {
		var id int64
		var createdAt string
		if err := rows.Scan(&id, &createdAt); err != nil {
			return nil, fmt.Errorf("scanning recently-failed thumbnail enhancement item: %w", err)
		}
		t, err := parseSQLiteTime(createdAt)
		if err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

// LatestSuccessRowIDs returns, for every library item with at least one
// 'success' history row, the id of its most recent one (MAX(id), since id is
// monotonically increasing with created_at) — used to show the Compare/
// Revert action on exactly one row per item, even when it's been enhanced
// more than once. Older success rows for the same item share the exact same
// original-thumbnail backup (backupOriginalIfAbsent only ever captures it
// once), but only the *latest* success row's output is still what's
// actually live at item.Thumbnail — an older row offering the same Compare
// action would misleadingly diff the backup against an enhancement result
// that's since been superseded.
func (r *ThumbnailEnhancementHistoryRepo) LatestSuccessRowIDs(ctx context.Context) (map[int64]int64, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT library_item_id, MAX(id)
		FROM thumbnail_enhancement_history
		WHERE status = 'success' AND library_item_id IS NOT NULL
		GROUP BY library_item_id`,
	)
	if err != nil {
		return nil, fmt.Errorf("querying latest successful thumbnail enhancement rows: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]int64)
	for rows.Next() {
		var itemID, rowID int64
		if err := rows.Scan(&itemID, &rowID); err != nil {
			return nil, fmt.Errorf("scanning latest successful thumbnail enhancement row: %w", err)
		}
		out[itemID] = rowID
	}
	return out, rows.Err()
}

// Delete removes one history entry and returns the library item it
// referenced (nil if the entry predates the item or the item was itself
// deleted) — callers use this to decide whether a cascade cleanup (e.g. an
// orphaned original-thumbnail backup) is needed.
func (r *ThumbnailEnhancementHistoryRepo) Delete(ctx context.Context, id int64) (*int64, error) {
	var libraryItemID sql.NullInt64
	err := r.db.QueryRowContext(ctx,
		`SELECT library_item_id FROM thumbnail_enhancement_history WHERE id = ?`, id,
	).Scan(&libraryItemID)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("looking up thumbnail enhancement history entry %d: %w", id, err)
	}

	if _, err := r.db.ExecContext(ctx, `DELETE FROM thumbnail_enhancement_history WHERE id = ?`, id); err != nil {
		return nil, fmt.Errorf("deleting thumbnail enhancement history entry %d: %w", id, err)
	}
	if !libraryItemID.Valid {
		return nil, nil
	}
	return &libraryItemID.Int64, nil
}

// CountByLibraryItemID reports how many history rows remain for one item —
// used to detect "this was the last one" after a Delete.
func (r *ThumbnailEnhancementHistoryRepo) CountByLibraryItemID(ctx context.Context, libraryItemID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM thumbnail_enhancement_history WHERE library_item_id = ?`, libraryItemID,
	).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("counting thumbnail enhancement history for item %d: %w", libraryItemID, err)
	}
	return n, nil
}

// MarkReverted stamps reverted_at on every still-live "success" row for
// libraryItemID created at or after since (the backup's own created_at,
// i.e. the start of the enhancement cycle a revert just undid) — so rows
// from an earlier cycle that was already locked in via DeleteOriginal stay
// untouched, only the cycle actually being reverted gets flagged. Returns
// how many rows were updated, for logging.
func (r *ThumbnailEnhancementHistoryRepo) MarkReverted(ctx context.Context, libraryItemID int64, since time.Time) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE thumbnail_enhancement_history
		SET reverted_at = datetime('now')
		WHERE library_item_id = ? AND status = 'success' AND created_at >= ? AND reverted_at IS NULL`,
		libraryItemID, since.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return 0, fmt.Errorf("marking thumbnail enhancement history reverted for item %d: %w", libraryItemID, err)
	}
	return res.RowsAffected()
}

// DeleteOlderThan removes every history entry created before cutoff,
// returning how many rows were deleted and the distinct library item ids
// those rows referenced — the retention sweep (thumbnailenhance.CleanupOldHistory)
// uses the ids to cascade-clean any item left with zero remaining rows,
// same as a manual single-row Delete does. created_at is stored as SQLite's
// datetime('now') text (UTC, "YYYY-MM-DD HH:MM:SS"), which sorts and
// compares correctly as a plain string, so cutoff is formatted the same way.
func (r *ThumbnailEnhancementHistoryRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, []int64, error) {
	cutoffStr := cutoff.UTC().Format("2006-01-02 15:04:05")

	rows, err := r.db.QueryContext(ctx,
		`SELECT DISTINCT library_item_id FROM thumbnail_enhancement_history
			WHERE created_at < ? AND library_item_id IS NOT NULL`, cutoffStr,
	)
	if err != nil {
		return 0, nil, fmt.Errorf("finding items affected by thumbnail enhancement history cleanup: %w", err)
	}
	var affected []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, nil, fmt.Errorf("scanning affected item id: %w", err)
		}
		affected = append(affected, id)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}
	rows.Close()

	res, err := r.db.ExecContext(ctx, `DELETE FROM thumbnail_enhancement_history WHERE created_at < ?`, cutoffStr)
	if err != nil {
		return 0, nil, fmt.Errorf("deleting old thumbnail enhancement history entries: %w", err)
	}
	n, err := res.RowsAffected()
	return n, affected, err
}
