// Package sysevents records the curated "system log": a small database-backed list of notable
// server events (startup, migrations, recovery, backups, security...) that survives container
// updates. It is NOT a logging framework; stdout logging is unchanged and only the events listed in
// docs/FEATURES.md are recorded.
//
// Rules for callers:
//   - Never call Record while holding an open transaction or a repository mutex. There is a single
//     database connection, so a write from inside a transaction would deadlock. Record after the
//     commit / unlock.
//   - Recording never fails or noticeably slows the operation it describes: errors go to stdout
//     only and are swallowed. A nil *Recorder is valid and does nothing.
//   - Privacy: never put URLs, titles, library file names, tokens, cookies, passwords, backup
//     passwords or file contents in a message or in details. Details hold counts, versions,
//     durations, folder or copy names and error text with credentials already masked. Record
//     scrubs URLs out of strings as a backstop, but callers are responsible for the rest.
package sysevents

import (
	"context"
	"encoding/json"
	"log"
	"regexp"
	"strconv"
	"sync"
	"time"

	"packrat/backend/internal/features"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// Levels.
const (
	LevelInfo    = "info"
	LevelWarning = "warning"
	LevelError   = "error"
)

// Categories.
const (
	CategoryStartup      = "startup"
	CategoryMigration    = "migration"
	CategoryRecovery     = "recovery"
	CategoryShutdown     = "shutdown"
	CategoryBackup       = "backup"
	CategoryRestore      = "restore"
	CategoryMaintenance  = "maintenance"
	CategoryYtdlp        = "ytdlp"
	CategorySecurity     = "security"
	CategorySubscription = "subscription"
)

const (
	// FloodWindow is how long an identical (level, category, message) event is suppressed after
	// it was recorded. There is no hard cap on the table, so this is what stops a loop that
	// reports the same problem from filling it.
	FloodWindow = 60 * time.Second

	writeTimeout   = 3 * time.Second
	maxStringLen   = 500
	maxDetailsSize = 8 * 1024
	// sweepAt is the size of the flood-guard map above which expired entries are dropped.
	sweepAt = 256
)

// Categories lists every category, for validation and docs.
var Categories = []string{
	CategoryStartup, CategoryMigration, CategoryRecovery, CategoryShutdown, CategoryBackup,
	CategoryRestore, CategoryMaintenance, CategoryYtdlp, CategorySecurity, CategorySubscription,
}

var urlPattern = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.\-]*://[^\s"'<>]+`)

type floodEntry struct {
	at     time.Time
	logged bool // the "dropped repeats" line was already printed for this window
}

// Recorder writes events. Create it once the database is migrated (the table exists by then).
type Recorder struct {
	repo     *repository.SystemEventsRepo
	settings *repository.SettingsRepo
	now      func() time.Time

	mu     sync.Mutex
	recent map[string]*floodEntry
}

// New returns a Recorder. settings is read on every Record call to honour the on/off switch.
func New(repo *repository.SystemEventsRepo, settings *repository.SettingsRepo) *Recorder {
	return &Recorder{repo: repo, settings: settings, now: time.Now, recent: map[string]*floodEntry{}}
}

// SetClock replaces the time source (tests).
func (r *Recorder) SetClock(now func() time.Time) { r.now = now }

// Enabled reports whether recording is switched on (default on).
func Enabled(ctx context.Context, settings *repository.SettingsRepo) bool {
	return features.Enabled(ctx, settings, models.SettingFeatureSystemEventsEnabled)
}

// Record stores one event unless the switch is off, the flood guard drops it, or the write fails
// (logged, never returned). details may be nil.
func (r *Recorder) Record(ctx context.Context, level, category, message string, details map[string]any) {
	if r == nil || r.repo == nil {
		return
	}
	if !Enabled(ctx, r.settings) {
		return
	}
	message = scrubString(message)
	if !r.admit(level, category, message) {
		return
	}

	raw := encodeDetails(details)
	// A cancelled request or a shutdown in progress must not drop the event, but the write is bounded.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
	defer cancel()
	if _, err := r.repo.Create(wctx, level, category, message, raw); err != nil {
		log.Printf("system log: recording %s/%s event failed: %v", category, level, err)
		r.forget(level, category, message)
	}
}

// admit applies the flood guard and reserves the slot when the event may be recorded.
func (r *Recorder) admit(level, category, message string) bool {
	key := level + "\x00" + category + "\x00" + message
	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.recent[key]; ok && now.Sub(e.at) < FloodWindow {
		if !e.logged {
			e.logged = true
			log.Printf("system log: dropping repeats of an identical %s/%s event for %s", category, level, FloodWindow)
		}
		return false
	}
	if len(r.recent) >= sweepAt {
		for k, e := range r.recent {
			if now.Sub(e.at) >= FloodWindow {
				delete(r.recent, k)
			}
		}
	}
	r.recent[key] = &floodEntry{at: now}
	return true
}

func (r *Recorder) forget(level, category, message string) {
	r.mu.Lock()
	delete(r.recent, level+"\x00"+category+"\x00"+message)
	r.mu.Unlock()
}

// scrubString removes URLs and caps the length.
func scrubString(s string) string {
	s = urlPattern.ReplaceAllString(s, "[url]")
	if len(s) > maxStringLen {
		s = s[:maxStringLen] + "…"
	}
	return s
}

func scrubValue(v any) any {
	switch t := v.(type) {
	case string:
		return scrubString(t)
	case []any:
		for i := range t {
			t[i] = scrubValue(t[i])
		}
		return t
	case map[string]any:
		for k := range t {
			t[k] = scrubValue(t[k])
		}
		return t
	default:
		return v
	}
}

// encodeDetails JSON-encodes details after scrubbing every string in it (including nested ones).
// nil or empty details, an unencodable value, or an oversized result yield nil: the event is still
// recorded, just without details.
func encodeDetails(details map[string]any) json.RawMessage {
	if len(details) == 0 {
		return nil
	}
	// Round-trip through JSON so typed values (slices, structs) are scrubbed too.
	b, err := json.Marshal(details)
	if err != nil {
		return nil
	}
	var generic map[string]any
	if err := json.Unmarshal(b, &generic); err != nil {
		return nil
	}
	b, err = json.Marshal(scrubValue(generic))
	if err != nil || len(b) > maxDetailsSize {
		return nil
	}
	return b
}

// RetentionCount reads system_events_retention_count: 0 (Unlimited) when unset, unreadable or invalid.
func RetentionCount(ctx context.Context, settings *repository.SettingsRepo) int {
	raw, err := settings.Get(ctx, models.SettingSystemEventsRetentionCount)
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// Prune deletes the oldest events beyond the configured count. Unlimited (0) never prunes. It runs
// regardless of the on/off switch (a stored backlog still obeys its limit). Errors are logged only.
func Prune(ctx context.Context, repo *repository.SystemEventsRepo, settings *repository.SettingsRepo) {
	if repo == nil {
		return
	}
	keep := RetentionCount(ctx, settings)
	if keep <= 0 {
		return
	}
	n, err := repo.PruneToCount(ctx, keep)
	if err != nil {
		log.Printf("system log: pruning failed: %v", err)
		return
	}
	if n > 0 {
		log.Printf("system log: pruned %d event(s) beyond the newest %d", n, keep)
	}
}
