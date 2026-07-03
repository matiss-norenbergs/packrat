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

export type WSEvent =
  | { type: "progress"; payload: ProgressPayload }
  | { type: "completed"; payload: CompletedPayload }
  | { type: "failed"; payload: FailedPayload }
  | { type: "queue_update"; payload: QueueUpdatePayload }
