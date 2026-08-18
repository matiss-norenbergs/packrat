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
  // Ghost (no-file placeholder) subset of itemCount/totalItemCount — always
  // <= its counterpart, same direct-vs-rolled-up scoping.
  ghostItemCount: number
  totalGhostItemCount: number
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
  /** true = exclude ghost (no-file placeholder) items; default/undefined = show everything, including ghosts */
  hideGhosts?: boolean
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
  mediaType: "video" | "audio" | null
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

export interface BulkDeleteLibraryItemFilesRequest {
  itemIds: number[]
  deleteThumbnail: boolean
}

export interface BulkRedownloadLibraryItemsRequest {
  itemIds: number[]
}

export interface BulkRedownloadResponse {
  queued: number
  skipped: number
}

export interface BulkFetchLibraryThumbnailsRequest {
  itemIds: number[]
}

export interface BulkFetchThumbnailsResponse {
  fetched: number
  skipped: number
}

// Response shape for the AI Enhancement page's bulk "Keep Enhanced"/"Keep
// Original" actions — Skipped covers items with no stored original backup
// (already committed/reverted, or never enhanced).
export interface BulkThumbnailOriginalsResponse {
  updated: number
  skipped: number
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

// Creates a library item with no downloaded file yet — see
// POST /library/ghost. fetchThumbnail is only honored when originalUrl is
// also set.
export interface CreateGhostLibraryItemRequest {
  title: string
  mediaType: "video" | "audio"
  originalUrl?: string
  collectionId?: number
  artistId?: number
  year?: number
  seasonNumber?: number
  sequenceNumber?: number
  generateNfo?: boolean
  tags?: string[]
  fetchThumbnail?: boolean
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

export type FrameMatchMode = "url" | "current"

export interface StartFrameMatchResponse {
  jobId: string
}

export interface FrameMatchStatus {
  state: "running" | "done" | "error"
  timestampSeconds?: number
  score?: number
  imageBase64?: string
  referenceImageBase64?: string
  error?: string
}

export interface BulkFrameMatchResponse {
  queued: number
  skipped: number
  alreadyQueued: number
}

// FrameMatchQueueItem is one row of the "Frame Matching" bulk queue —
// unlike FrameMatchStatus (the single-item dialog's ephemeral job, carrying
// images inline as base64), this is a durable row: found/reference images
// live on disk and are resolved via imageUrl().
export interface FrameMatchQueueItem {
  id: number
  libraryItemId: number
  itemTitle: string
  mode: FrameMatchMode
  state: "queued" | "running" | "done" | "error"
  timestampSeconds?: number
  score?: number
  foundFramePath?: string
  referenceImagePath?: string
  error?: string
}

// ThumbnailGalleryImage is one saved image in a library item's thumbnail
// gallery — imagePath is relative to ImagesRoot, resolved via imageUrl().
export interface ThumbnailGalleryImage {
  id: number
  imagePath: string
  width: number | null
  height: number | null
  createdAt: string
}

export interface MissingLibraryFile {
  id: number
  title: string
}

export interface ScanMissingLibraryFilesResult {
  scanned: number
  missing: MissingLibraryFile[]
}

export interface MoveLibraryItemRequest {
  collectionId?: number | null
  folder: string
}

export interface Settings {
  downloadDirectory: string
  maxConcurrentDownloads: number
  maxConcurrentTranscodes: number
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
  thumbnailResolutionTierMediumEnabled: boolean
  thumbnailResolutionThresholdLow: number
  thumbnailResolutionThresholdHigh: number
  thumbnailEnhancementEnabled: boolean
  thumbnailEnhancementUrl: string
  thumbnailEnhancementUsername: string
  thumbnailEnhancementPassword: string
  thumbnailEnhancementUpscaler: string
  thumbnailEnhancementMinDim: number
  thumbnailEnhancementFactor: number
  thumbnailEnhancementTargetMode: "factor" | "resolution"
  thumbnailEnhancementTargetDim: number
  thumbnailEnhancementScheduleEnabled: boolean
  thumbnailEnhancementRetentionDays: number
  thumbnailEnhancementAutoApprove: boolean
  thumbnailEnhancementAutoOnDownload: boolean
  thumbnailEnhancementMaxPerSweep: number
}

export interface YtDlpVersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
}

export interface AppVersion {
  version: string
  latestVersion: string | null
  updateAvailable: boolean
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
  maxConcurrentTranscodes?: number
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
  thumbnailResolutionTierMediumEnabled?: boolean
  thumbnailResolutionThresholdLow?: number
  thumbnailResolutionThresholdHigh?: number
  thumbnailEnhancementEnabled?: boolean
  thumbnailEnhancementUrl?: string
  thumbnailEnhancementUsername?: string
  thumbnailEnhancementPassword?: string
  thumbnailEnhancementUpscaler?: string
  thumbnailEnhancementMinDim?: number
  thumbnailEnhancementFactor?: number
  thumbnailEnhancementTargetMode?: "factor" | "resolution"
  thumbnailEnhancementTargetDim?: number
  thumbnailEnhancementScheduleEnabled?: boolean
  thumbnailEnhancementRetentionDays?: number
  thumbnailEnhancementAutoApprove?: boolean
  thumbnailEnhancementAutoOnDownload?: boolean
  thumbnailEnhancementMaxPerSweep?: number
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
  isGhost?: boolean
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
  ghostsCreated: number
}

// LibraryImportMode picks what an import does with an item that has a saved
// URL — "download" (default) queues a redownload, "ghostOnly" recreates
// every item as a placeholder instead. Items with no URL (or already
// ghost-status) become ghosts either way.
export type LibraryImportMode = "download" | "ghostOnly"

export interface BackupRestoreFullResult {
  settingsApplied: number
  library: BackupImportLibraryResult
}

export interface FullImportPreview {
  settingsCount: number
  library: LibraryImportPreview
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
  isGhost?: boolean
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
  // Ghost (no-file placeholder) subset of the two counts above.
  libraryVideoGhostCount: number
  libraryAudioGhostCount: number
  totalStorageBytes: number
  // Describe the filesystem underlying the server's media root, not the
  // whole host — 0/0 if the disk-usage lookup failed server-side.
  diskTotalBytes: number
  diskFreeBytes: number
}

// One calendar day's tally from GET /stats/library-growth, oldest first.
// cumulative is a running total over the item's entire history, not just
// the returned range.
export interface LibraryGrowthPoint {
  date: string
  count: number
  cumulative: number
}

// One standard resolution step's item count from GET
// /stats/resolution-breakdown — always includes every step (0 count if
// empty), in ascending step order.
export interface ResolutionBreakdownPoint {
  step: number
  count: number
}

// A saved channel/playlist URL, periodically re-checked for new uploads —
// see internal/subscriptions on the backend. knownEntryCount is how many
// entries have ever been seen (baseline + every new one found since).
export interface Subscription {
  id: number
  url: string
  title: string
  mediaType: "video" | "audio"
  collectionId: number | null
  collectionName: string | null
  tags: string[]
  autoDownload: boolean
  generateNfo: boolean
  checkIntervalHours: number
  enabled: boolean
  lastCheckedAt: string | null
  lastCheckError: string | null
  knownEntryCount: number
  unseenEntryCount: number
  createdAt: string
}

// url/mediaType are immutable after creation — see UpdateSubscriptionRequest.
export interface CreateSubscriptionRequest {
  url: string
  mediaType: "video" | "audio"
  collectionId?: number
  tags?: string[]
  autoDownload: boolean
  generateNfo: boolean
  checkIntervalHours: number
}

export interface UpdateSubscriptionRequest {
  collectionId?: number | null
  tags: string[]
  autoDownload: boolean
  generateNfo: boolean
  checkIntervalHours: number
  enabled: boolean
}

export interface CheckSubscriptionResult {
  newItemsFound: number
}

// One row of a subscription's "Known items" dialog. Entries recorded before
// the metadata migration have title/url as "" and durationSeconds as null —
// there's nothing to act on for those, they just render as "Unknown."
export interface SubscriptionEntry {
  sourceId: string
  title: string
  url: string
  durationSeconds: number | null
  libraryItemId: number | null
  seenAt: string | null
  firstSeenAt: string
}

// One row of the AI Enhancement page's history table — one attempted item,
// success or failed. The dimension/size fields are null when the
// corresponding step never completed (e.g. a connection failure leaves
// enhancedWidth/Height/SizeBytes null but originalWidth/Height/SizeBytes
// set).
export interface ThumbnailEnhancementHistoryEntry {
  id: number
  libraryItemId: number | null
  itemTitle: string
  status: "success" | "failed"
  originalWidth: number | null
  originalHeight: number | null
  enhancedWidth: number | null
  enhancedHeight: number | null
  originalSizeBytes: number | null
  enhancedSizeBytes: number | null
  error: string | null
  createdAt: string
  // Reflect the item's *current* live state (whether a pre-enhancement
  // backup still exists), not this specific historical attempt — every
  // row for the same item shows the same values.
  hasOriginalBackup: boolean
  // Relative to ImagesRoot — serve via imageUrl(). The backup, at its
  // original (pre-enhancement) resolution.
  originalThumbnailPath: string | null
  // Relative to MediaRoot — serve via mediaFileUrl(), NOT imageUrl(). The
  // raw sidecar file at its actual enhanced resolution, not a downscaled
  // WebP tier, so it's a fair visual comparison against originalThumbnailPath.
  enhancedThumbnailPath: string | null
  // Set once this row's own enhancement was undone by a later revert — a
  // real historical fact about this specific row, unlike hasOriginalBackup
  // above which reflects current item state.
  revertedAt: string | null
  triggerType: "manual" | "scheduled" | "auto"
  // "upscale" (the original feature, resized per the factor/target-size
  // setting) or "sharpen" (denoise/detail pass only, output stays the same
  // size — manual-only, from the Library toolbar or an item's Thumbnail menu).
  mode: "upscale" | "sharpen"
}

// ThumbnailEnhancementHistoryListResponse is the paginated wrapper around
// ThumbnailEnhancementHistoryEntry rows — {entries,total} convention, same
// as the Library page's list response.
export interface ThumbnailEnhancementHistoryListResponse {
  entries: ThumbnailEnhancementHistoryEntry[]
  total: number
}

// Queued (not "enhanced") — the run is fire-and-forget: this is how many
// items were handed off to the background sweep, not how many have
// finished. Live per-item progress arrives separately over the
// enhance_progress WebSocket event.
export interface RunThumbnailEnhancementResult {
  queued: number
}

// Configured is false whenever the feature is disabled or has no URL saved
// yet — reachable/error are meaningless in that case, there's nothing to
// probe.
export interface ThumbnailEnhancementStatus {
  configured: boolean
  reachable: boolean
  error: string | null
}

// One row of the "Preview eligible items" dialog — a live snapshot of what
// the next "Enhance now" click (or scheduled sweep) would consider, not a
// completed attempt like ThumbnailEnhancementHistoryEntry.
export interface ThumbnailEnhancementEligibleItem {
  libraryItemId: number
  itemTitle: string
  width: number
  height: number
  artistName: string | null
  collectionName: string | null
  // Set when this item's most recent attempt failed within the last hour —
  // automatic runs skip it, but it still appears here so it stays manually
  // retryable.
  recentlyFailedAt: string | null
  // Client-only — patched in live by useDownloadsSocket from the
  // enhance_progress WebSocket event, not part of the initial fetch.
  isProcessing?: boolean
}

export type AddSubscriptionEntryMode = "ghost" | "download"

export interface AddSubscriptionEntryResult {
  mode: AddSubscriptionEntryMode
  libraryItemId?: number
  downloadId?: number
}
