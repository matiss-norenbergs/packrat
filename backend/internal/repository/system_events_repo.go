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

// systemEventsTimeLayout is how created_at is stored (SQLite's datetime('now'), UTC); it sorts and
// compares correctly as plain text.
const systemEventsTimeLayout = "2006-01-02 15:04:05"

// SystemEventsRepo stores the persistent system log. Callers that record events go through the
// sysevents package, which must never be called inside a transaction (there is a single connection).
type SystemEventsRepo struct {
	db *sql.DB
}

func NewSystemEventsRepo(db *sql.DB) *SystemEventsRepo { return &SystemEventsRepo{db: db} }

// SystemEventQuery selects a page of events. Zero values mean "no filter" / defaults.
type SystemEventQuery struct {
	Levels     []string
	Categories []string
	// Text is a case-insensitive substring match on the message.
	Text string
	// From is inclusive, Before exclusive (both compared at one-second resolution).
	From   *time.Time
	Before *time.Time
	// Sort is a key of the allowlist ("createdAt" when empty or unknown); Desc picks the direction.
	Sort string
	Desc bool
	// Page is 1-based; PageSize defaults to 50 (the API caps it).
	Page     int
	PageSize int
}

// systemEventSortColumns is the allowlist from API sort key to SQL column.
var systemEventSortColumns = map[string]string{
	"createdAt": "created_at",
	"level":     "level",
	"category":  "category",
}

// ValidSystemEventSort reports whether key is an allowed sort key.
func ValidSystemEventSort(key string) bool {
	_, ok := systemEventSortColumns[key]
	return ok
}

// SystemEventFacet is one value of a filterable column with its count.
type SystemEventFacet struct {
	Value string
	Count int
}

// Create stores one event and returns its id. details may be nil.
func (r *SystemEventsRepo) Create(ctx context.Context, level, category, message string, details json.RawMessage) (int64, error) {
	var d any
	if len(details) > 0 {
		d = string(details)
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO system_events (level, category, message, details) VALUES (?, ?, ?, ?)`,
		level, category, message, d)
	if err != nil {
		return 0, fmt.Errorf("inserting system event: %w", err)
	}
	return res.LastInsertId()
}

func (q SystemEventQuery) where() (string, []any) {
	var conds []string
	var args []any
	in := func(col string, vals []string) {
		if len(vals) == 0 {
			return
		}
		conds = append(conds, col+" IN ("+placeholderList(len(vals))+")")
		args = append(args, anySlice(vals)...)
	}
	in("level", q.Levels)
	in("category", q.Categories)
	if q.Text != "" {
		conds = append(conds, `instr(lower(message), lower(?)) > 0`)
		args = append(args, q.Text)
	}
	if q.From != nil {
		conds = append(conds, `created_at >= ?`)
		args = append(args, q.From.UTC().Format(systemEventsTimeLayout))
	}
	if q.Before != nil {
		conds = append(conds, `created_at < ?`)
		args = append(args, q.Before.UTC().Format(systemEventsTimeLayout))
	}
	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// Query returns one page of events and the total number matching the filters. The column name only
// ever comes from the sort allowlist; every value is a bound parameter. Rows tie-break on
// created_at then id, in the sort direction.
func (r *SystemEventsRepo) Query(ctx context.Context, q SystemEventQuery) ([]models.SystemEvent, int, error) {
	where, args := q.where()

	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM system_events`+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting system events: %w", err)
	}

	col, ok := systemEventSortColumns[q.Sort]
	if !ok {
		col = "created_at"
	}
	dir := "ASC"
	if q.Desc {
		dir = "DESC"
	}
	order := col + " " + dir + ", created_at " + dir + ", id " + dir
	if col == "created_at" {
		order = "created_at " + dir + ", id " + dir
	}

	pageSize := q.PageSize
	if pageSize <= 0 {
		pageSize = 50
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	qargs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, created_at, level, category, message, details FROM system_events`+where+
			` ORDER BY `+order+` LIMIT ? OFFSET ?`, qargs...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing system events: %w", err)
	}
	defer rows.Close()

	out := []models.SystemEvent{}
	for rows.Next() {
		var e models.SystemEvent
		var created string
		var details sql.NullString
		if err := rows.Scan(&e.ID, &created, &e.Level, &e.Category, &e.Message, &details); err != nil {
			return nil, 0, fmt.Errorf("scanning system event: %w", err)
		}
		if t, err := time.ParseInLocation(systemEventsTimeLayout, created, time.UTC); err == nil {
			e.CreatedAt = t
		}
		if details.Valid && details.String != "" {
			e.Details = json.RawMessage(details.String)
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

// Facets returns the distinct levels and categories with their counts over all stored events.
func (r *SystemEventsRepo) Facets(ctx context.Context) (levels, categories []SystemEventFacet, err error) {
	facets := func(col string) ([]SystemEventFacet, error) {
		rows, err := r.db.QueryContext(ctx, `SELECT `+col+`, COUNT(*) FROM system_events GROUP BY `+col+` ORDER BY `+col)
		if err != nil {
			return nil, fmt.Errorf("system event facets: %w", err)
		}
		defer rows.Close()
		out := []SystemEventFacet{}
		for rows.Next() {
			var f SystemEventFacet
			if err := rows.Scan(&f.Value, &f.Count); err != nil {
				return nil, err
			}
			out = append(out, f)
		}
		return out, rows.Err()
	}
	if levels, err = facets("level"); err != nil {
		return nil, nil, err
	}
	if categories, err = facets("category"); err != nil {
		return nil, nil, err
	}
	return levels, categories, nil
}

// DeleteByIDs removes the given events in one transaction (all or nothing) and returns how many
// existed. Ids that do not exist are ignored.
func (r *SystemEventsRepo) DeleteByIDs(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("deleting system events: %w", err)
	}
	defer tx.Rollback()
	var deleted int64
	err = inChunks(ids, inChunkSize, func(chunk []int64) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM system_events WHERE id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		deleted += n
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("deleting system events: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("deleting system events: %w", err)
	}
	return deleted, nil
}

// DeleteAll removes every event and returns how many there were.
func (r *SystemEventsRepo) DeleteAll(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM system_events`)
	if err != nil {
		return 0, fmt.Errorf("clearing system events: %w", err)
	}
	return res.RowsAffected()
}

// PruneToCount deletes the oldest events beyond the newest keep. keep <= 0 means Unlimited and
// deletes nothing. Returns the number deleted.
func (r *SystemEventsRepo) PruneToCount(ctx context.Context, keep int) (int64, error) {
	if keep <= 0 {
		return 0, nil
	}
	res, err := r.db.ExecContext(ctx, `
		DELETE FROM system_events WHERE id IN (
			SELECT id FROM system_events ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)`, keep)
	if err != nil {
		return 0, fmt.Errorf("pruning system events: %w", err)
	}
	return res.RowsAffected()
}
