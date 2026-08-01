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
  filenameTemplate?: string
  generateNfo?: boolean
  tags?: string[]
}

export interface Collection {
  id: number
  name: string
  parentId: number | null
  rootPath: string
  path: string
  defaultQuality: string
  defaultDownloadType: DownloadType
  filenameTemplate: string
  isPrivate: boolean
  seasonNumber: number | null
  year: number | null
  sequenceMin: number | null
  sequenceMax: number | null
  artistId: number | null
  coverImagePath: string | null
  coverImageSmallPath: string | null
  coverImageMediumPath: string | null
  browseAsShow: boolean
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
  // Gaps in this collection's own items' sequence numbers (same direct-only
  // scope as itemCount) — null when there are fewer than two sequence-
  // numbered items, or none at all missing between the smallest and largest.
  sequenceGaps: { min: number; max: number; count: number; missing: number[] } | null
  // The thumbnail (original tier — see librarySmallThumbnailUrl for the
  // fallback chain) of the most recently downloaded item anywhere in this
  // collection's subtree — Browse's fallback cover for a show/album tile
  // with no explicit coverImagePath set. Null if the subtree has no
  // thumbnailed item at all.
  latestItemThumbnailPath: string | null
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
  filenameTemplate?: string
  isPrivate?: boolean
  jellyfinLibraryId?: string | null
  seasonNumber?: number | null
  year?: number | null
  sequenceMin?: number | null
  sequenceMax?: number | null
  artistId?: number | null
  browseAsShow?: boolean
}

export type UpdateCollectionRequest = CreateCollectionRequest

export interface CollectionCoverCandidate {
  relPath: string
}

// Exactly one of sourceRelPath (copy an existing on-disk file, e.g. a
// candidate from fetchCollectionCoverCandidates) or imageBase64+filename (a
// fresh upload) must be set.
export interface SetCollectionCoverRequest {
  sourceRelPath?: string
  imageBase64?: string
  filename?: string
}

export interface LibraryQueryParams {
  q?: string
  /** number = exact collection; null = uncategorized only (folder view's root); undefined = no filter */
  collectionId?: number | null
  /** IN-match against a set of collection ids — used only to resolve a bulk-selected folder plus its nested subcollections into concrete items; takes precedence over collectionId when set. */
  collectionIds?: number[]
  artistId?: number
  year?: number
  tags?: string[]
  /** true = only items eligible for "Continue Watching" (tracked position, past the barely-started floor, short of the credits-rolled ceiling) */
  inProgress?: boolean
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
  thumbnailSmallPath: string | null
  thumbnailMediumPath: string | null
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
  playbackPositionSeconds: number | null
  lastWatchedAt: string | null
}

export interface UpdateLibraryProgressRequest {
  positionSeconds: number
}

// GET /library/:id/probe-metadata — a read-only ffprobe pass over the item's
// actual media file, used by the Edit dialog's rescan-resolution/duration
// prompt. Never persisted server-side by this endpoint.
export interface LibraryItemProbeResult {
  resolution: string | null
  durationSeconds: number | null
  frameRate: number
}

// POST /library/:id/trim/preview's body — at least one of the two must be
// set; the other means "don't trim that end".
export interface TrimPreviewRequest {
  trimStartSeconds?: number
  trimEndSeconds?: number
}

// The generated preview's MediaRoot-relative path (playable via
// mediaFileUrl()) plus what its actual duration/size came out to.
export interface TrimPreviewResult {
  previewPath: string
  durationSeconds: number
  fileSizeBytes: number
}

// One decoded frame from GET /library/:id/trim/frames — the trim dialog's
// "browse every frame in a short window, click the exact one" picker.
export interface TrimFrame {
  timestampSeconds: number
  imageBase64: string
}

export interface LibraryItemMetadataPreview {
  title: string
  uploader: string
  duration: number
  description: string
  thumbnail: string
  resolution: string | null
}

// The "Redownload from different URL" dialog's right-hand preview — same
// fields as LibraryItemMetadataPreview, plus whether the candidate URL
// already matches a *different* library item.
export interface RedownloadPreview extends LibraryItemMetadataPreview {
  duplicate: DuplicateInfo | null
}

// Subset of comparable fields the "Redownload from different URL" dialog
// lets the user opt into overwriting — resolution/duration are always
// available and checked by default; the rest default unchecked. Mirrors
// the backend's redownloadOverwritableFields allowlist.
export type RedownloadOverwriteField = "title" | "uploader" | "description" | "thumbnail" | "resolution" | "duration"

export interface BulkAssignTagsRequest {
  itemIds: number[]
  tags: string[]
}

export interface AddToCompareListRequest {
  itemIds: number[]
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
  isPrivate: boolean
  createdAt: string
  usageCount: number
}

export interface CreateTagRequest {
  name: string
  isPrivate?: boolean
}

export interface UpdateTagRequest {
  name: string
  isPrivate?: boolean
}

export interface Artist {
  id: number
  name: string
  selectedImagePath: string | null
  // Date-only string ("2006-01-02"), null when unset.
  birthday: string | null
  createdAt: string
  usageCount: number
}

export interface CreateArtistRequest {
  name: string
  birthday?: string | null
}

export interface UpdateArtistRequest {
  name: string
  birthday?: string | null
}

export interface ArtistImage {
  id: number
  relativePath: string
  createdAt: string
}

export interface ArtistImageCandidate {
  relPath: string
}

// Exactly one of sourceRelPath (copy an existing on-disk file, e.g. a
// candidate from fetchArtistImageCandidates) or imageBase64+filename (a
// fresh upload) must be set.
export interface SetArtistImageRequest {
  sourceRelPath?: string
  imageBase64?: string
  filename?: string
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
  privacyEnabled: boolean
  privacyBlurStrength: string
  browseIgnorePrivacy: boolean
  skipDownloadPreview: boolean
  jellyfinEnabled: boolean
  jellyfinUrl: string
  jellyfinApiKey: string
  jellyfinRefreshMode: string
  libraryAutoplay: boolean
  ytdlpCookiesBrowser: string
  ytdlpCookiesProfile: string
  ytdlpProxy: string
  ytdlpRateLimit: string
  ytdlpRetries: number
  autoBackupIntervalHours: number
  backupRetentionCount: number
  resolutionTierMediumEnabled: boolean
  resolutionThresholdLow: number
  resolutionThresholdHigh: number
}

export interface YtDlpVersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
}

export interface AppVersion {
  version: string
}

// Progress snapshot for the background image-derivative backfill (small/
// medium/original WebP tiers for library thumbnails, artist images, and
// collection covers) — GET/POST /settings/backfill-images both return this.
export interface ImageBackfillStatus {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  libraryProcessed: number
  libraryFailed: number
  artistProcessed: number
  artistFailed: number
  coverProcessed: number
  coverFailed: number
}

export interface DownloadPreview {
  title: string
  uploader: string
  uploadDate: string
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
  privacyEnabled?: boolean
  privacyBlurStrength?: string
  browseIgnorePrivacy?: boolean
  skipDownloadPreview?: boolean
  jellyfinEnabled?: boolean
  jellyfinUrl?: string
  jellyfinApiKey?: string
  jellyfinRefreshMode?: string
  libraryAutoplay?: boolean
  ytdlpCookiesBrowser?: string
  ytdlpCookiesProfile?: string
  ytdlpProxy?: string
  ytdlpRateLimit?: string
  ytdlpRetries?: number
  autoBackupIntervalHours?: number
  backupRetentionCount?: number
  resolutionTierMediumEnabled?: boolean
  resolutionThresholdLow?: number
  resolutionThresholdHigh?: number
}

export interface BackupHistoryEntry {
  id: number
  createdAt: string
  triggerType: "manual" | "scheduled"
  status: "success" | "failed"
  fileName: string | null
  fileSizeBytes: number | null
  libraryItemsCount: number | null
  collectionsCount: number | null
  tagsCount: number | null
  artistsCount: number | null
  errorMessage: string | null
}

export interface BackupPreviewCollection {
  path: string[]
  name: string
}

export interface BackupPreviewItem {
  title: string
  originalUrl: string
  collectionPath?: string[]
  artistName?: string
  tags?: string[]
}

export interface BackupContentPreview {
  settingsCount: number
  collections: BackupPreviewCollection[]
  tags: string[]
  artists: string[]
  items: BackupPreviewItem[]
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

export interface PreviewCollectionEntry {
  path: string[]
  name: string
  isNew: boolean
}

export interface PreviewLibraryItem {
  title: string
  originalUrl: string
  collectionPath?: string[]
  artistName?: string
  tags?: string[]
  downloadType?: string
  quality?: string
  year?: number
  alreadyInLibrary: boolean
}

export interface LibraryImportPreview {
  collections: PreviewCollectionEntry[]
  collectionsNew: number
  tags: string[]
  tagsNew: number
  artists: string[]
  artistsNew: number
  items: PreviewLibraryItem[]
  alreadyInLibrary: number
}

export interface Stats {
  activeDownloads: number
  queuedDownloads: number
  completedToday: number
  libraryVideoCount: number
  libraryAudioCount: number
  totalStorageBytes: number
}

// One calendar day's tally from GET /stats/library-growth, oldest first.
// cumulative is a running total over the item's entire history, not just
// the returned range.
export interface LibraryGrowthPoint {
  date: string
  count: number
  cumulative: number
}
