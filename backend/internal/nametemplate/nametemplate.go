// Package nametemplate resolves a user-supplied filename template (e.g.
// "{artist}/{title}") against a download's known metadata into a sanitized,
// possibly-nested set of path segments.
package nametemplate

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"packrat/backend/internal/fsutil"
)

// Vars holds the values a filename template's {variable} tokens resolve
// against. An empty field just substitutes as an empty string — there is no
// conditional-segment logic (e.g. "drop this whole segment if {sequence} is
// blank"); a template that relies on an optional field being present is the
// caller's responsibility, same as any other templating tool.
type Vars struct {
	Title      string
	Uploader   string
	Date       string // yt-dlp upload_date, YYYYMMDD
	Artist     string
	Year       string
	Season     string
	Sequence   string
	Collection string
}

// tokenPattern matches {name} or {name:modifier} — modifier is everything up
// to the closing brace, so it may itself contain punctuation (e.g. ".", "_")
// but never "}".
var tokenPattern = regexp.MustCompile(`\{(title|uploader|channel|date|artist|year|season|sequence|collection)(?::([^}]+))?\}`)

// Resolve substitutes every {variable} or {variable:modifier} token in tmpl
// against vars, then splits the result on "/" and sanitizes each path
// segment independently via fsutil.SanitizeFilename — unlike running
// SanitizeFilename on the whole resolved string (which would strip the "/"
// itself and flatten everything into one run-together name), this lets a
// template like "{artist}/{title}" express a real subfolder. Segments that
// sanitize down to "" (an empty variable, or a traversal attempt like ".." —
// SanitizeFilename trims leading/trailing dots, so ".." and "..foo"/"foo.."
// all collapse harmlessly) are dropped rather than producing an empty path
// component. Returns nil for a blank/whitespace-only template, so callers
// can treat that the same as "no template set."
//
// A token's modifier is either:
//   - a run of digits, e.g. "{season:02}" — the resolved value is parsed as
//     an integer and zero-padded to that width. If the value doesn't parse
//     as an integer (e.g. a digit modifier used on a text field), the
//     modifier is silently ignored and the raw value is used instead.
//   - anything else, e.g. "{artist:.}" — treated as a join string: runs of
//     whitespace inside the resolved value are replaced with it, so
//     "Rick Astley" with modifier "." becomes "Rick.Astley".
func Resolve(tmpl string, vars Vars) []string {
	if strings.TrimSpace(tmpl) == "" {
		return nil
	}

	values := map[string]string{
		"title":      vars.Title,
		"uploader":   vars.Uploader,
		"channel":    vars.Uploader,
		"date":       vars.Date,
		"artist":     vars.Artist,
		"year":       vars.Year,
		"season":     vars.Season,
		"sequence":   vars.Sequence,
		"collection": vars.Collection,
	}

	resolved := tokenPattern.ReplaceAllStringFunc(tmpl, func(match string) string {
		groups := tokenPattern.FindStringSubmatch(match)
		name, modifier := groups[1], groups[2]
		value := values[name]
		return applyModifier(value, modifier)
	})

	var segments []string
	for _, seg := range strings.Split(resolved, "/") {
		if clean := fsutil.SanitizeFilename(seg); clean != "" {
			segments = append(segments, clean)
		}
	}
	return segments
}

func applyModifier(value, modifier string) string {
	if modifier == "" {
		return value
	}
	if width, err := strconv.Atoi(modifier); err == nil {
		if n, err := strconv.Atoi(value); err == nil {
			return fmt.Sprintf("%0*d", width, n)
		}
		return value
	}
	return strings.Join(strings.Fields(value), modifier)
}
