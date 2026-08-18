export interface ProgressPayload {
  downloadId: number
  status: string
  percent: number
  speedBytesPerSec: number
  etaSeconds: number
  downloadedBytes: number
  totalBytes: number
}

export interface CompletedPayload {
  downloadId: number
  libraryId: number
  title: string
}

export interface FailedPayload {
  downloadId: number
  status: "failed" | "cancelled"
  error: string
}

export interface QueueUpdatePayload {
  active: number
  queued: number
}

// EnhanceProgressPayload reports one library item's AI-enhancement status,
// regardless of which trigger (scheduled sweep, manual "Enhance Now",
// bulk-selected, or auto-on-download) caused it.
export interface EnhanceProgressPayload {
  libraryItemId: number
  itemTitle: string
  status: "processing" | "success" | "failed"
  error?: string
}

// FrameMatchProgressPayload reports one frame_match_queue row's state
// change, regardless of trigger.
export interface FrameMatchProgressPayload {
  queueId: number
  libraryItemId: number
  itemTitle: string
  state: "running" | "done" | "error"
  error?: string
}

export type WSEvent =
  | { type: "progress"; payload: ProgressPayload }
  | { type: "completed"; payload: CompletedPayload }
  | { type: "failed"; payload: FailedPayload }
  | { type: "queue_update"; payload: QueueUpdatePayload }
  | { type: "enhance_progress"; payload: EnhanceProgressPayload }
  | { type: "frame_match_progress"; payload: FrameMatchProgressPayload }
