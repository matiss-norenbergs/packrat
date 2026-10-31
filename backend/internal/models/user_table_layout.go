package models

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
)

// A saved table layout (user_table_layouts table). The schema already carries sorting and column
// widths so the features that use them need no backend change; the API validates all of it.
const (
	TableLayoutVersion     = 1
	TableLayoutMaxBytes    = 4 << 10
	TableLayoutMaxColumns  = 64
	TableLayoutMinWidth    = 24
	TableLayoutMaxWidth    = 2000
	MaxTableLayoutsPerUser = 100
)

var (
	tableIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	colKeyPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// ValidTableID reports whether id is an acceptable table identifier.
func ValidTableID(id string) bool { return tableIDPattern.MatchString(id) }

type TableLayoutSort struct {
	Key string `json:"key"`
	Dir string `json:"dir"`
}

// TableLayout is the stored document. Field order here is the canonical JSON key order.
type TableLayout struct {
	V      int              `json:"v"`
	Sort   *TableLayoutSort `json:"sort,omitempty"`
	Hidden []string         `json:"hidden,omitempty"`
	Widths map[string]int   `json:"widths,omitempty"`
}

// ParseTableLayout validates raw (a JSON object with only the known fields) and returns its
// canonical JSON: fixed field order, sorted keys, empty optional fields omitted.
func ParseTableLayout(raw []byte) (string, error) {
	if len(raw) > TableLayoutMaxBytes {
		return "", fmt.Errorf("layout is larger than %d bytes", TableLayoutMaxBytes)
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return "", errors.New("layout must be a JSON object")
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var l TableLayout
	if err := dec.Decode(&l); err != nil {
		return "", fmt.Errorf("invalid layout: %w", err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return "", errors.New("invalid layout: unexpected data after the object")
	}
	if l.V != TableLayoutVersion {
		return "", fmt.Errorf(`layout field "v" is required and must be %d`, TableLayoutVersion)
	}
	if l.Sort != nil {
		if !colKeyPattern.MatchString(l.Sort.Key) {
			return "", errors.New("invalid sort.key")
		}
		if l.Sort.Dir != "asc" && l.Sort.Dir != "desc" {
			return "", errors.New(`sort.dir must be "asc" or "desc"`)
		}
	}
	if len(l.Hidden) > TableLayoutMaxColumns {
		return "", fmt.Errorf("hidden has more than %d entries", TableLayoutMaxColumns)
	}
	seen := make(map[string]bool, len(l.Hidden))
	for _, k := range l.Hidden {
		if !colKeyPattern.MatchString(k) {
			return "", fmt.Errorf("invalid column key %q in hidden", k)
		}
		if seen[k] {
			return "", fmt.Errorf("duplicate column key %q in hidden", k)
		}
		seen[k] = true
	}
	sort.Strings(l.Hidden)
	if len(l.Widths) > TableLayoutMaxColumns {
		return "", fmt.Errorf("widths has more than %d entries", TableLayoutMaxColumns)
	}
	for k, w := range l.Widths {
		if !colKeyPattern.MatchString(k) {
			return "", fmt.Errorf("invalid column key %q in widths", k)
		}
		if w < TableLayoutMinWidth || w > TableLayoutMaxWidth {
			return "", fmt.Errorf("width of %q must be between %d and %d", k, TableLayoutMinWidth, TableLayoutMaxWidth)
		}
	}
	out, err := json.Marshal(l)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
