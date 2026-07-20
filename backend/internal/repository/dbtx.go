package repository

import (
	"context"
	"database/sql"
)

// dbtx is satisfied by both *sql.DB and *sql.Tx, letting a repo run its
// queries against either — a plain connection pool normally, or a shared
// transaction when a caller needs several repos' writes to commit or roll
// back together (see WithTx on TagsRepo/CollectionsRepo/ArtistsRepo, used by
// backup.ApplyLibraryBundle).
type dbtx interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
