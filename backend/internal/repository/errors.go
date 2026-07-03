package repository

import "errors"

// ErrNotFound is returned by Get methods when no row matches the given id.
var ErrNotFound = errors.New("not found")
