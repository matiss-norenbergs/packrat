package repository

import (
	"encoding/json"
	"strings"
)

// inChunkSize caps how many ids go into one `IN (?,?,…)` list. SQLite allows
// 32,766 bound variables per statement; 500 keeps even the sites that bind
// each id twice (plus status and subscription params) far below that.
const inChunkSize = 500

// inChunks calls fn with consecutive slices of ids, each at most size long,
// stopping at the first error. fn is never called for an empty ids. Callers
// building `IN (...)` lists from unbounded input must go through this (or
// bind a single json_each parameter, see jsonArrayArg) so a large library
// can't hit SQLite's variable limit.
func inChunks[T any](ids []T, size int, fn func(chunk []T) error) error {
	for start := 0; start < len(ids); start += size {
		end := start + size
		if end > len(ids) {
			end = len(ids)
		}
		if err := fn(ids[start:end]); err != nil {
			return err
		}
	}
	return nil
}

// placeholderList returns "?,?,?" for n parameters.
func placeholderList(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// anySlice converts a typed slice to []any for use as query args.
func anySlice[T any](vals []T) []any {
	out := make([]any, len(vals))
	for i, v := range vals {
		out[i] = v
	}
	return out
}

// jsonArrayArg marshals vals as a JSON array, to be bound as the single
// parameter of `col IN (SELECT value FROM json_each(?))`. Used for filter
// conditions inside a larger list query, which can't be split into chunks.
func jsonArrayArg[T any](vals []T) string {
	b, err := json.Marshal(vals)
	if err != nil {
		// Only ints and strings are passed; marshalling those cannot fail.
		return "[]"
	}
	return string(b)
}
