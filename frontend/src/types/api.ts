export type DownloadStatus =
  | "queued"
  | "fetching_metadata"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type DownloadType = "video" | "audio"
export type AudioFormat = "mp3" | "flac" | "m4a" | "aac" | "wav"
export type VideoQuality = "best" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "worst"

export interface Download {
  id: number
  url: string
  collectionId: number | null
  folder: string
  filename: string
  downloadType: DownloadType
  quality: string
  audioFormat: string | null
  status: DownloadStatus
  title: string | null
  uploader: string | null
  duration: number | null
  thumbnail: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  percent: number
  speedBytesPerSec: number
  etaSeconds: number
  downloadedBytes: number
  totalBytes: number
}

export interface CreateDownloadRequest {
  url: string
  collectionId?: number | null
  folder?: string
  filename?: string
  downloadType: DownloadType
  quality?: string
  audioFormat?: string
}

export interface LibraryItem {
  id: number
  downloadId: number | null
  title: string
  filename: string
  path: string
  collectionId: number | null
  folder: string
  originalUrl: string
  uploader: string | null
  duration: number | null
  resolution: string | null
  thumbnail: string | null
  description: string | null
  downloadedAt: string
  status: string
}
