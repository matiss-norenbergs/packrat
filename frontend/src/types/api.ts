export interface AuthStatus {
  setupRequired: boolean
  authenticated: boolean
}

export interface SetupRequest {
  username: string
  password: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

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
  title?: string
  artist?: string
  year?: number
  seasonNumber?: number
  sequenceNumber?: number
  filenamePrefix?: string
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
  itemCount: number
  jellyfinLibraryId: string | null
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
  jellyfinLibraryId?: string | null
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
  sequenceNumber: number | null
  seasonNumber: number | null
  generateNfo: boolean
  nfoExists: boolean
  downloadedAt: string
  status: string
  blurred: boolean
  fileSizeBytes: number | null
  tags: string[]
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
  sequenceNumber?: number
  seasonNumber?: number
  generateNfo?: boolean
  originalUrl?: string
  tags?: string[]
}

export interface Tag {
  id: number
  name: string
  createdAt: string
  usageCount: number
}

export interface CreateTagRequest {
  name: string
}

export interface UpdateTagRequest {
  name: string
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
  libraryMode: string
  thumbnailFrameCount: number
  privacyBlurStrength: string
  skipDownloadPreview: boolean
  jellyfinEnabled: boolean
  jellyfinUrl: string
  jellyfinApiKey: string
}

export interface DownloadPreview {
  title: string
  uploader: string
  duration: number
  thumbnail: string
  resolution: string | null
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
  libraryMode?: string
  thumbnailFrameCount?: number
  privacyBlurStrength?: string
  skipDownloadPreview?: boolean
  jellyfinEnabled?: boolean
  jellyfinUrl?: string
  jellyfinApiKey?: string
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
