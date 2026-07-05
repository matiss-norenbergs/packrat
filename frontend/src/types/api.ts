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
  collectionName: string | null
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
  blurred: boolean
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

export interface Collection {
  id: number
  name: string
  parentId: number | null
  rootPath: string
  path: string
  defaultQuality: string
  defaultDownloadType: DownloadType
  isPrivate: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCollectionRequest {
  name: string
  parentId?: number | null
  rootPath: string
  defaultQuality?: string
  defaultDownloadType?: DownloadType
  isPrivate?: boolean
}

export type UpdateCollectionRequest = CreateCollectionRequest

export interface LibraryItem {
  id: number
  downloadId: number | null
  title: string
  filename: string
  path: string
  collectionId: number | null
  collectionName: string | null
  folder: string
  originalUrl: string | null
  uploader: string | null
  duration: number | null
  resolution: string | null
  thumbnail: string | null
  description: string | null
  artist: string | null
  year: number | null
  downloadedAt: string
  status: string
  blurred: boolean
}

export interface UpdateLibraryItemRequest {
  title?: string
  filename?: string
  uploader?: string
  description?: string
  duration?: number
  resolution?: string
  artist?: string
  year?: number
  originalUrl?: string
}

export interface ThumbnailCandidate {
  timestampSeconds: number
  imageBase64: string
}

export interface MoveLibraryItemRequest {
  collectionId?: number | null
  folder: string
}

export interface Settings {
  downloadDirectory: string
  maxConcurrentDownloads: number
  defaultQuality: string
  defaultDownloadType: DownloadType
  importIgnoredFolders: string[]
  historyAnonymizeUrls: boolean
  libraryView: string
  librarySortKey: string
  librarySortDir: string
  thumbnailFrameCount: number
}

export interface UpdateSettingsRequest {
  maxConcurrentDownloads?: number
  defaultQuality?: string
  defaultDownloadType?: DownloadType
  importIgnoredFolders?: string[]
  historyAnonymizeUrls?: boolean
  libraryView?: string
  librarySortKey?: string
  librarySortDir?: string
  thumbnailFrameCount?: number
}

export interface ScannedFile {
  path: string
  filename: string
  sizeBytes: number
  durationSeconds: number | null
  resolution: string | null
  collectionPath: string
  newCollectionPath: string
}

export interface ImportRequest {
  path: string
  originalUrl?: string
}

export interface HistoryItem {
  id: number
  downloadId: number | null
  url: string
  title: string | null
  thumbnail: string | null
  status: DownloadStatus
  errorMessage: string | null
  createdAt: string
}

export interface LogEntry {
  id: number
  title: string | null
  url: string
  status: DownloadStatus
  ytdlpCommand: string | null
  exitCode: number | null
  stdoutTail: string | null
  stderrTail: string | null
  retryCount: number
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface Stats {
  activeDownloads: number
  queuedDownloads: number
  completedToday: number
  libraryVideoCount: number
  libraryAudioCount: number
  totalStorageBytes: number
}
