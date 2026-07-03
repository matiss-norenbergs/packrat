package ws

type EventType string

const (
	EventProgress    EventType = "progress"
	EventCompleted   EventType = "completed"
	EventFailed      EventType = "failed"
	EventQueueUpdate EventType = "queue_update"
)

type Event struct {
	Type    EventType `json:"type"`
	Payload any       `json:"payload"`
}

type ProgressPayload struct {
	DownloadID int64   `json:"downloadId"`
	Status     string  `json:"status"`
	Percent    float64 `json:"percent"`
	Speed      float64 `json:"speedBytesPerSec"`
	ETA        int     `json:"etaSeconds"`
	Downloaded int64   `json:"downloadedBytes"`
	Total      int64   `json:"totalBytes"`
}

type CompletedPayload struct {
	DownloadID int64  `json:"downloadId"`
	LibraryID  int64  `json:"libraryId"`
	Title      string `json:"title"`
}

type FailedPayload struct {
	DownloadID int64  `json:"downloadId"`
	Status     string `json:"status"` // "failed" | "cancelled"
	Error      string `json:"error"`
}

type QueueUpdatePayload struct {
	Active int `json:"active"`
	Queued int `json:"queued"`
}

// Broadcaster is satisfied by Hub. It is defined here (rather than in the
// consuming queue package) so both queue and any future caller can depend on
// this narrow interface without importing the full Hub/Client machinery.
type Broadcaster interface {
	Broadcast(Event)
}
