package models

import (
	"encoding/json"
	"time"
)

// SystemEvent is one row of the persistent system log (see the sysevents package).
type SystemEvent struct {
	ID        int64
	CreatedAt time.Time
	Level     string
	Category  string
	Message   string
	// Details is a small JSON object, or nil when the event has none.
	Details json.RawMessage
}
