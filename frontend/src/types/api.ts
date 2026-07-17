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
  | "duplicate"

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
  artistId?: number
  year?: number
  seasonNumber?: number
  sequenceNumber?: number
  filenamePrefix?: string
  generateNfo?: boolean
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
  // Inheritance-aware versions of the two fields above — isPrivate/itemCount
  // are this collection's own flag and its own direct item count (what the
  // tree/folder-tile UI wants); these instead answer "is this private once
  // ancestors are considered, and is there anything at all (including
  // descendants) under here" — needed by the Library toolbar's reveal-all
  // button, which can't otherwise tell if a private parent with no items of
  // its own actually has any blurred content in its children.
  effectiveIsPrivate: boolean
  totalItemCount: number
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

export interface LibraryQueryParams {
  q?: string
  /** number = exact collection; null = uncategorized only (folder view's root); undefined = no filter */
  collectionId?: number | null
  /** IN-match against a set of collection ids — used only to resolve a bulk-selected folder plus its nested subcollections into concrete items; takes precedence over collectionId when set. */
  collectionIds?: number[]
  year?: number
  tags?: string[]
  sortKey?: string
  sortDir?: string
  page?: number
  pageSize?: number
}

export interface LibraryListResponse {
  items: LibraryItem[]
  total: number
}

export interface LibraryFacets {
  years: number[]
}

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
  artistId: number | null
  artistName: string | null
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

export interface BulkAssignTagsRequest {
  itemIds: number[]
  tags: string[]
}

export interface BulkDeleteRequest {
  ids: number[]
}

export interface BulkDeleteResponse {
  deleted: number
  skipped?: number[]
}

export interface BulkDeleteLibraryItemsRequest {
  itemIds: number[]
  deleteFiles: boolean
}

export interface UpdateLibraryItemRequest {
  title?: string
  filename?: string
  uploader?: string
  description?: string
  duration?: number
  resolution?: string
  artistId?: number
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

export interface Artist {
  id: number
  name: string
  createdAt: string
  usageCount: number
}

export interface CreateArtistRequest {
  name: string
}

export interface UpdateArtistRequest {
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
  downloadTimeoutMinutes: number
  defaultQuality: string
  defaultDownloadType: DownloadType
  importIgnoredFolders: string[]
  historyAnonymizeUrls: boolean
  historyRetentionDays: number
  downloadLogRetentionDays: number
  libraryView: string
  librarySortKey: string
  librarySortDir: string
  libraryMode: string
  libraryPaginationEnabled: boolean
  libraryPageSize: number
  thumbnailFrameCount: number
  privacyBlurStrength: string
  skipDownloadPreview: boolean
  jellyfinEnabled: boolean
  jellyfinUrl: string
  jellyfinApiKey: string
  jellyfinRefreshMode: string
  libraryAutoplay: boolean
}

export interface YtDlpVersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
}

export interface DownloadPreview {
  title: string
  uploader: string
  duration: number
  thumbnail: string
  resolution: string | null
  isPlaylist: boolean
  playlistTitle: string | null
  playlistCount: number
  duplicate: DuplicateInfo | null
}

export interface DuplicateInfo {
  libraryItemId: number
  title: string
  thumbnail: string | null
  downloadedAt: string
}

export type PlaylistMode = "current" | "entire" | "range" | "first_n"

export interface CreatePlaylistDownloadRequest {
  url: string
  collectionId?: number | null
  downloadType: DownloadType
  quality?: string
  audioFormat?: string
  playlistMode: PlaylistMode
  playlistStart?: number
  playlistEnd?: number
  playlistLimit?: number
  skipDuplicates: boolean
}

export interface CreateBatchDownloadRequest {
  items: CreateDownloadRequest[]
  skipDuplicates: boolean
}

export interface QueuedItem {
  id: number
  url: string
}

export interface SkippedItem {
  url: string
  title: string
  libraryItemId: number
}

export interface FailedItem {
  url: string
  error: string
}

export interface EnqueueResult {
  queued: QueuedItem[]
  skipped: SkippedItem[]
  failed: FailedItem[]
}

export interface UpdateSettingsRequest {
  maxConcurrentDownloads?: number
  downloadTimeoutMinutes?: number
  defaultQuality?: string
  defaultDownloadType?: DownloadType
  importIgnoredFolders?: string[]
  historyAnonymizeUrls?: boolean
  historyRetentionDays?: number
  downloadLogRetentionDays?: number
  libraryView?: string
  librarySortKey?: string
  librarySortDir?: string
  libraryMode?: string
  libraryPaginationEnabled?: boolean
  libraryPageSize?: number
  thumbnailFrameCount?: number
  privacyBlurStrength?: string
  skipDownloadPreview?: boolean
  jellyfinEnabled?: boolean
  jellyfinUrl?: string
  jellyfinApiKey?: string
  jellyfinRefreshMode?: string
  libraryAutoplay?: boolean
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

export interface BackupEnvelope {
  packrat: boolean
  version: number
  kind: "settings" | "library"
  exportedAt: string
  encrypted: boolean
  salt?: string
  data: string
}

export interface BackupImportSettingsResult {
  applied: number
}

export interface BackupImportLibraryResult {
  collectionsEnsured: number
  tagsCreated: number
  artistsCreated: number
  downloadsQueued: number
}

export interface Stats {
  activeDownloads: number
  queuedDownloads: number
  completedToday: number
  libraryVideoCount: number
  libraryAudioCount: number
  totalStorageBytes: number
}
