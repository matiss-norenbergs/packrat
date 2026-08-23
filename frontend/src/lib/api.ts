import type {
  AddToCompareListRequest,
  AppVersion,
  Artist,
  ArtistImage,
  ArtistImageCandidate,
  AuthStatus,
  BackupContentPreview,
  BackupEnvelope,
  BackupHistoryEntry,
  BackupImportLibraryResult,
  BackupImportSettingsResult,
  BackupRestoreFullResult,
  FullImportPreview,
  LibraryImportMode,
  BulkAssignTagsRequest,
  BulkDeleteLibraryItemFilesRequest,
  BulkDeleteLibraryItemsRequest,
  BulkDeleteRequest,
  BulkDeleteResponse,
  BulkFetchLibraryThumbnailsRequest,
  BulkFetchThumbnailsResponse,
  BulkRedownloadLibraryItemsRequest,
  AddSubscriptionEntryMode,
  AddSubscriptionEntryResult,
  BulkRedownloadResponse,
  BulkThumbnailOriginalsResponse,
  ChangePasswordRequest,
  CheckSubscriptionResult,
  Collection,
  CollectionCoverCandidate,
  CreateArtistRequest,
  CreateBatchDownloadRequest,
  CreateCollectionRequest,
  CreateDownloadRequest,
  CreateGhostLibraryItemRequest,
  CreatePlaylistDownloadRequest,
  Download,
  DownloadPreview,
  EnqueueResult,
  HistoryItem,
  ImageBackfillStatus,
  ImportRequest,
  BulkFrameMatchResponse,
  FrameMatchMode,
  FrameMatchQueueItem,
  FrameMatchStatus,
  StartFrameMatchResponse,
  LibraryFacets,
  LibraryItem,
  LibraryImportPreview,
  LibraryItemMetadataPreview,
  LibraryItemProbeResult,
  LibraryGrowthPoint,
  ResolutionBreakdownPoint,
  LibraryListResponse,
  LibraryQueryParams,
  LoginRequest,
  LogEntry,
  MoveLibraryItemRequest,
  ScanMissingLibraryFilesResult,
  ScannedFile,
  Settings,
  SetArtistImageRequest,
  SetCollectionCoverRequest,
  SetupRequest,
  Stats,
  Subscription,
  SubscriptionEntry,
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
  Tag,
  ThumbnailCandidate,
  ThumbnailGalleryImage,
  ThumbnailEnhancementHistoryListResponse,
  RunThumbnailEnhancementResult,
  ThumbnailEnhancementStatus,
  ThumbnailEnhancementEligibleItem,
  ProxyStatus,
  CreateTagRequest,
  RedownloadOverwriteField,
  RedownloadPreview,
  TrimFrame,
  TrimPreviewRequest,
  TrimPreviewResult,
  UpdateArtistRequest,
  UpdateCollectionRequest,
  UpdateLibraryItemRequest,
  UpdateLibraryProgressRequest,
  UpdateSettingsRequest,
  UpdateTagRequest,
  YtDlpVersionInfo,
} from "@/types/api"

// Reads a cookie's raw value by name — used to echo the CSRF cookie back as
// a header (see request() below). Cross-origin JS can never read this
// cookie for a forged request, which is the entire double-submit-cookie
// CSRF defense (backend/internal/api/csrf.go).
function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ""
}

// All JSON API routes live under /api (kept distinct from the frontend's
// client-side routes of the same name, e.g. /downloads and /library — see
// backend/internal/api/router.go).
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": getCookie("packrat_csrf"), ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>("/auth/status")
}

export function fetchAppVersion(): Promise<AppVersion> {
  return request<AppVersion>("/version")
}

export function setupAccount(payload: SetupRequest): Promise<void> {
  return request<void>("/auth/setup", { method: "POST", body: JSON.stringify(payload) })
}

export function login(payload: LoginRequest): Promise<void> {
  return request<void>("/auth/login", { method: "POST", body: JSON.stringify(payload) })
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" })
}

export function changePassword(payload: ChangePasswordRequest): Promise<void> {
  return request<void>("/auth/password", { method: "PATCH", body: JSON.stringify(payload) })
}

export function fetchDownloads(): Promise<Download[]> {
  return request<Download[]>("/downloads")
}

export function createDownload(payload: CreateDownloadRequest): Promise<{ id: number }> {
  return request<{ id: number }>("/downloads", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function previewDownload(url: string): Promise<DownloadPreview> {
  return request<DownloadPreview>("/downloads/preview", {
    method: "POST",
    body: JSON.stringify({ url }),
  })
}

export function createPlaylistDownload(payload: CreatePlaylistDownloadRequest): Promise<EnqueueResult> {
  return request<EnqueueResult>("/downloads/playlist", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createBatchDownload(payload: CreateBatchDownloadRequest): Promise<EnqueueResult> {
  return request<EnqueueResult>("/downloads/batch", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function cancelDownload(id: number): Promise<void> {
  return request<void>(`/downloads/${id}/cancel`, { method: "POST" })
}

export function deleteDownload(id: number): Promise<void> {
  return request<void>(`/downloads/${id}`, { method: "DELETE" })
}

// fetchLibrary returns the entire library, unfiltered — for call sites that
// genuinely need every item (the item detail page's sibling strip). Grid/
// folder views use fetchLibraryQuery instead, which does search/filter/sort/
// pagination server-side.
export function fetchLibrary(): Promise<LibraryItem[]> {
  return fetchLibraryQuery({}).then((res) => res.items)
}

export function fetchLibraryQuery(params: LibraryQueryParams): Promise<LibraryListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.collectionIds && params.collectionIds.length > 0) search.set("collectionIds", params.collectionIds.join(","))
  else if (params.collectionId === null) search.set("collectionId", "none")
  else if (params.collectionId != null) search.set("collectionId", String(params.collectionId))
  if (params.artistId != null) search.set("artistId", String(params.artistId))
  if (params.year != null) search.set("year", String(params.year))
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","))
  if (params.inProgress) search.set("inProgress", "true")
  if (params.hideGhosts) search.set("hideGhosts", "true")
  if (params.sortKey) search.set("sortKey", params.sortKey)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.page != null) search.set("page", String(params.page))
  if (params.pageSize != null) search.set("pageSize", String(params.pageSize))
  const qs = search.toString()
  return request<LibraryListResponse>(`/library${qs ? `?${qs}` : ""}`)
}

export function fetchLibraryFacets(): Promise<LibraryFacets> {
  return request<LibraryFacets>("/library/facets")
}

export function mediaFileUrl(relativePath: string): string {
  return `/media-files/${relativePath.split("/").map(encodeURIComponent).join("/")}`
}

// Routes an external image URL (a pasted direct-image-download URL, or a
// yt-dlp-reported thumbnail URL) through the backend instead of pointing an
// <img> at it directly — an <img src> fetch happens in the browser and has
// no way to honor the backend's configured yt-dlp proxy setting, so a direct
// fetch would silently bypass it. Used only for the New Download dialog's
// pre-submit preview; every other image in the app is already backend-local
// (mediaFileUrl/imageUrl above).
export function previewImageUrl(externalUrl: string): string {
  return `/api/downloads/preview-image?url=${encodeURIComponent(externalUrl)}`
}

// Resolves a relative path under the backend's images root (artist/collection
// pictures Packrat itself copied in) into a URL — mirrors mediaFileUrl().
export function imageUrl(relativePath: string): string {
  return `/local-images/${relativePath.split("/").map(encodeURIComponent).join("/")}`
}

// Fetches whatever's already showing at an <img>'s src — a mediaFileUrl()/
// imageUrl() path or a data: URI alike — and returns it as bare base64, for
// call sites that only have a rendered image's URL but need the bytes to
// hand to an endpoint like saveThumbnailToGallery.
export async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image"))
    reader.readAsDataURL(blob)
  })
}

// Small/medium-tier URL builders with a fallback to the original — items
// created before the multi-size-image feature shipped (or not yet
// backfilled) have no derivative paths yet, so every display site falls
// back to the original rather than showing a broken image. The two tiers
// live under different roots (derivatives under ImagesRoot via imageUrl(),
// the original under MediaRoot via mediaFileUrl()), so the helper — not
// each call site — is what needs to know which root a given field resolves
// against.
export function librarySmallThumbnailUrl(item: Pick<LibraryItem, "thumbnail" | "thumbnailSmallPath">): string | null {
  if (item.thumbnailSmallPath) return imageUrl(item.thumbnailSmallPath)
  return item.thumbnail ? mediaFileUrl(item.thumbnail) : null
}

export function libraryMediumThumbnailUrl(item: Pick<LibraryItem, "thumbnail" | "thumbnailMediumPath">): string | null {
  if (item.thumbnailMediumPath) return imageUrl(item.thumbnailMediumPath)
  return item.thumbnail ? mediaFileUrl(item.thumbnail) : null
}

// Collection cover tiers all live under ImagesRoot already, so no
// mediaFileUrl() fallback is needed here — just fall back to the original
// cover path when the requested derivative isn't populated yet.
export function collectionSmallCoverUrl(c: Pick<Collection, "coverImagePath" | "coverImageSmallPath">): string | null {
  const p = c.coverImageSmallPath ?? c.coverImagePath
  return p ? imageUrl(p) : null
}

export function collectionMediumCoverUrl(c: Pick<Collection, "coverImagePath" | "coverImageMediumPath">): string | null {
  const p = c.coverImageMediumPath ?? c.coverImagePath
  return p ? imageUrl(p) : null
}

export function deleteLibraryItem(id: number, deleteFiles: boolean): Promise<void> {
  return request<void>(`/library/${id}?deleteFiles=${deleteFiles}`, { method: "DELETE" })
}

export function createGhostLibraryItem(payload: CreateGhostLibraryItemRequest): Promise<LibraryItem> {
  return request<LibraryItem>("/library/ghost", { method: "POST", body: JSON.stringify(payload) })
}

export function deleteLibraryItemFile(id: number, deleteThumbnail: boolean): Promise<void> {
  return request<void>(`/library/${id}/file?deleteThumbnail=${deleteThumbnail}`, { method: "DELETE" })
}

export function deleteLibraryItemThumbnail(id: number): Promise<void> {
  return request<void>(`/library/${id}/thumbnail`, { method: "DELETE" })
}

export function scanMissingLibraryFiles(): Promise<ScanMissingLibraryFilesResult> {
  return request<ScanMissingLibraryFilesResult>("/library/scan-missing", { method: "POST" })
}

export function updateLibraryItem(id: number, payload: UpdateLibraryItemRequest): Promise<void> {
  return request<void>(`/library/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function bulkAssignTags(payload: BulkAssignTagsRequest): Promise<void> {
  return request<void>("/library/bulk-tags", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function bulkDeleteLibraryItems(payload: BulkDeleteLibraryItemsRequest): Promise<BulkDeleteResponse> {
  return request<BulkDeleteResponse>("/library/bulk-delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function bulkDeleteLibraryItemFiles(payload: BulkDeleteLibraryItemFilesRequest): Promise<BulkDeleteResponse> {
  return request<BulkDeleteResponse>("/library/bulk-delete-file", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function bulkRedownloadLibraryItems(payload: BulkRedownloadLibraryItemsRequest): Promise<BulkRedownloadResponse> {
  return request<BulkRedownloadResponse>("/library/bulk-redownload", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function bulkFetchLibraryThumbnails(
  payload: BulkFetchLibraryThumbnailsRequest,
): Promise<BulkFetchThumbnailsResponse> {
  return request<BulkFetchThumbnailsResponse>("/library/bulk-fetch-thumbnails", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function moveLibraryItem(id: number, payload: MoveLibraryItemRequest): Promise<void> {
  return request<void>(`/library/${id}/move`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateLibraryItemProgress(id: number, payload: UpdateLibraryProgressRequest): Promise<void> {
  return request<void>(`/library/${id}/progress`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function refreshLibraryItemMetadata(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/refresh-metadata`, { method: "POST" })
}

export function probeLibraryItemMetadata(id: number): Promise<LibraryItemProbeResult> {
  return request<LibraryItemProbeResult>(`/library/${id}/probe-metadata`)
}

export function previewLibraryItemTrim(id: number, payload: TrimPreviewRequest): Promise<TrimPreviewResult> {
  return request<TrimPreviewResult>(`/library/${id}/trim/preview`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function acceptLibraryItemTrim(id: number, previewPath: string): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/trim/accept`, {
    method: "POST",
    body: JSON.stringify({ previewPath }),
  })
}

export function discardLibraryItemTrim(id: number, previewPath: string): Promise<void> {
  return request<void>(`/library/${id}/trim/discard`, {
    method: "POST",
    body: JSON.stringify({ previewPath }),
  })
}

export function fetchLibraryItemTrimFrames(id: number, start: number, end: number): Promise<{ frames: TrimFrame[] }> {
  return request<{ frames: TrimFrame[] }>(`/library/${id}/trim/frames?start=${start}&end=${end}`)
}

export function redownloadLibraryItem(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/library/${id}/redownload`, { method: "POST" })
}

export function fetchRedownloadPreview(id: number, url: string): Promise<RedownloadPreview> {
  return request<RedownloadPreview>(`/library/${id}/redownload/preview-url?url=${encodeURIComponent(url)}`)
}

export function redownloadLibraryItemFromUrl(
  id: number,
  url: string,
  overwriteFields: RedownloadOverwriteField[],
): Promise<{ id: number }> {
  return request<{ id: number }>(`/library/${id}/redownload/from-url`, {
    method: "POST",
    body: JSON.stringify({ url, overwriteFields }),
  })
}

export function redownloadLibraryThumbnail(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail/redownload`, { method: "POST" })
}

export function quickGrabLibraryThumbnail(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail/quick-grab`, { method: "POST" })
}

export function fetchLibraryThumbnailCandidates(
  id: number,
  params?: { timestamps?: number[]; exclude?: number[] },
): Promise<{ candidates: ThumbnailCandidate[] }> {
  const search = new URLSearchParams()
  if (params?.timestamps?.length) search.set("timestamps", params.timestamps.join(","))
  if (params?.exclude?.length) search.set("exclude", params.exclude.join(","))
  const qs = search.toString()
  return request<{ candidates: ThumbnailCandidate[] }>(`/library/${id}/thumbnail/candidates${qs ? `?${qs}` : ""}`)
}

export function fetchLibraryItemMetadataPreview(id: number): Promise<LibraryItemMetadataPreview> {
  return request<LibraryItemMetadataPreview>(`/library/${id}/metadata-preview`)
}

export function setLibraryThumbnail(id: number, imageBase64: string): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail`, {
    method: "POST",
    body: JSON.stringify({ imageBase64 }),
  })
}

// saveThumbnailToGallery saves an image to a library item's thumbnail
// gallery without touching its active thumbnail. Omit imageBase64 to save a
// copy of the item's current active thumbnail; pass it to save exact bytes
// already on hand instead (a picker candidate frame).
export function saveThumbnailToGallery(id: number, imageBase64?: string): Promise<ThumbnailGalleryImage> {
  return request<ThumbnailGalleryImage>(`/library/${id}/thumbnail/gallery`, {
    method: "POST",
    body: imageBase64 ? JSON.stringify({ imageBase64 }) : undefined,
  })
}

export function fetchThumbnailGallery(id: number): Promise<{ images: ThumbnailGalleryImage[] }> {
  return request<{ images: ThumbnailGalleryImage[] }>(`/library/${id}/thumbnail/gallery`)
}

export function applyThumbnailFromGallery(id: number, galleryId: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail/gallery/${galleryId}/apply`, { method: "POST" })
}

export function deleteThumbnailGalleryImage(id: number, galleryId: number): Promise<void> {
  return request<void>(`/library/${id}/thumbnail/gallery/${galleryId}`, { method: "DELETE" })
}

export function startFrameMatch(id: number, mode: FrameMatchMode): Promise<StartFrameMatchResponse> {
  return request<StartFrameMatchResponse>(`/library/${id}/thumbnail/match`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  })
}

export function getFrameMatchStatus(jobId: string): Promise<FrameMatchStatus> {
  return request<FrameMatchStatus>(`/thumbnail-match/${jobId}`)
}

export function bulkStartFrameMatch(itemIds: number[], mode: FrameMatchMode): Promise<BulkFrameMatchResponse> {
  return request<BulkFrameMatchResponse>("/library/thumbnail/match/bulk", {
    method: "POST",
    body: JSON.stringify({ itemIds, mode }),
  })
}

export function fetchFrameMatchQueue(): Promise<FrameMatchQueueItem[]> {
  return request<FrameMatchQueueItem[]>("/frame-match/queue")
}

export function acceptFrameMatchQueueItem(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/frame-match/queue/${id}/accept`, { method: "POST" })
}

export function discardFrameMatchQueueItem(id: number): Promise<void> {
  return request<void>(`/frame-match/queue/${id}`, { method: "DELETE" })
}

export function generateLibraryItemNFO(id: number): Promise<void> {
  return request<void>(`/library/${id}/nfo`, { method: "POST" })
}

export function fetchLibraryItemNFO(id: number): Promise<{ content: string }> {
  return request<{ content: string }>(`/library/${id}/nfo`)
}

export function deleteLibraryItemNFO(id: number): Promise<void> {
  return request<void>(`/library/${id}/nfo`, { method: "DELETE" })
}

export function fetchCollections(): Promise<Collection[]> {
  return request<Collection[]>("/collections")
}

export function createCollection(payload: CreateCollectionRequest): Promise<{ id: number }> {
  return request<{ id: number }>("/collections", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateCollection(id: number, payload: UpdateCollectionRequest): Promise<void> {
  return request<void>(`/collections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteCollection(id: number): Promise<void> {
  return request<void>(`/collections/${id}`, { method: "DELETE" })
}

export function bulkDeleteCollections(payload: BulkDeleteRequest): Promise<BulkDeleteResponse> {
  return request<BulkDeleteResponse>("/collections/bulk-delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function fetchCollectionCoverCandidates(id: number): Promise<{ candidates: CollectionCoverCandidate[] }> {
  return request<{ candidates: CollectionCoverCandidate[] }>(`/collections/${id}/cover-candidates`)
}

export function setCollectionCover(id: number, payload: SetCollectionCoverRequest): Promise<{ coverImagePath: string }> {
  return request<{ coverImagePath: string }>(`/collections/${id}/cover`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteCollectionCover(id: number): Promise<void> {
  return request<void>(`/collections/${id}/cover`, { method: "DELETE" })
}

export function fetchSettings(): Promise<Settings> {
  return request<Settings>("/settings")
}

export function updateSettings(payload: UpdateSettingsRequest): Promise<void> {
  return request<void>("/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function rescanJellyfinLibrary(): Promise<void> {
  return request<void>("/jellyfin/rescan", { method: "POST" })
}

export function fetchYtDlpVersion(): Promise<YtDlpVersionInfo> {
  return request<YtDlpVersionInfo>("/ytdlp/version")
}

export function updateYtDlp(): Promise<{ version: string }> {
  return request<{ version: string }>("/ytdlp/update", { method: "POST" })
}

export function fetchImageBackfillStatus(): Promise<ImageBackfillStatus> {
  return request<ImageBackfillStatus>("/settings/backfill-images")
}

export function startImageBackfill(): Promise<ImageBackfillStatus> {
  return request<ImageBackfillStatus>("/settings/backfill-images", { method: "POST" })
}

export function fetchImportScan(): Promise<ScannedFile[]> {
  return request<ScannedFile[]>("/import/scan")
}

export function createImport(payload: ImportRequest): Promise<LibraryItem> {
  return request<LibraryItem>("/import", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function fetchHistory(): Promise<HistoryItem[]> {
  return request<HistoryItem[]>("/history")
}

export function fetchLogs(): Promise<LogEntry[]> {
  return request<LogEntry[]>("/logs")
}

export function retryHistoryItem(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/history/${id}/retry`, { method: "POST" })
}

export function deleteHistoryItem(id: number): Promise<void> {
  return request<void>(`/history/${id}`, { method: "DELETE" })
}

export function clearHistory(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/history/clear", { method: "POST" })
}

export function clearDownloadLog(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/downloads/clear-log", { method: "POST" })
}

export function fetchStats(): Promise<Stats> {
  return request<Stats>("/stats")
}

export function fetchLibraryGrowth(): Promise<LibraryGrowthPoint[]> {
  return request<LibraryGrowthPoint[]>("/stats/library-growth")
}

export function fetchResolutionBreakdown(): Promise<ResolutionBreakdownPoint[]> {
  return request<ResolutionBreakdownPoint[]>("/stats/resolution-breakdown")
}

export function exportSettingsBackup(password: string): Promise<BackupEnvelope> {
  return request<BackupEnvelope>("/backup/export/settings", {
    method: "POST",
    body: JSON.stringify({ password: password || undefined }),
  })
}

export function exportLibraryBackup(password: string): Promise<BackupEnvelope> {
  return request<BackupEnvelope>("/backup/export/library", {
    method: "POST",
    body: JSON.stringify({ password: password || undefined }),
  })
}

export function importSettingsBackup(data: string, password: string): Promise<BackupImportSettingsResult> {
  return request<BackupImportSettingsResult>("/backup/import/settings", {
    method: "POST",
    body: JSON.stringify({ data, password: password || undefined }),
  })
}

export function importLibraryBackup(
  data: string,
  password: string,
  mode?: LibraryImportMode,
): Promise<BackupImportLibraryResult> {
  return request<BackupImportLibraryResult>("/backup/import/library", {
    method: "POST",
    body: JSON.stringify({ data, password: password || undefined, mode }),
  })
}

export function previewLibraryImport(data: string, password: string): Promise<LibraryImportPreview> {
  return request<LibraryImportPreview>("/backup/preview/library", {
    method: "POST",
    body: JSON.stringify({ data, password: password || undefined }),
  })
}

export function fetchBackupHistory(): Promise<BackupHistoryEntry[]> {
  return request<BackupHistoryEntry[]>("/backup/history")
}

export function runManualBackup(): Promise<BackupHistoryEntry> {
  return request<BackupHistoryEntry>("/backup/run", { method: "POST" })
}

export function deleteBackupHistoryEntry(id: number): Promise<void> {
  return request<void>(`/backup/history/${id}`, { method: "DELETE" })
}

// Not request()-wrapped: this needs to be a real browser navigation (a plain
// <a href> click) so the server's Content-Disposition header triggers a
// native save, rather than a JS-intercepted fetch response. Includes the
// /api prefix explicitly since it bypasses request()'s auto-prefixing.
export function backupDownloadUrl(id: number): string {
  return `/api/backup/history/${id}/download`
}

export function fetchBackupPreview(id: number): Promise<BackupContentPreview> {
  return request<BackupContentPreview>(`/backup/history/${id}/preview`)
}

export function restoreFullBackup(id: number, mode: LibraryImportMode): Promise<BackupRestoreFullResult> {
  return request<BackupRestoreFullResult>(`/backup/history/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  })
}

export function previewFullImport(data: string, password: string): Promise<FullImportPreview> {
  return request<FullImportPreview>("/backup/preview/full", {
    method: "POST",
    body: JSON.stringify({ data, password: password || undefined }),
  })
}

export function importFullBackup(
  data: string,
  password: string,
  mode: LibraryImportMode,
): Promise<BackupRestoreFullResult> {
  return request<BackupRestoreFullResult>("/backup/import/full", {
    method: "POST",
    body: JSON.stringify({ data, password: password || undefined, mode }),
  })
}

export function fetchTags(): Promise<Tag[]> {
  return request<Tag[]>("/tags")
}

export function createTag(payload: CreateTagRequest): Promise<{ id: number }> {
  return request<{ id: number }>("/tags", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateTag(id: number, payload: UpdateTagRequest): Promise<void> {
  return request<void>(`/tags/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteTag(id: number): Promise<void> {
  return request<void>(`/tags/${id}`, { method: "DELETE" })
}

export function bulkDeleteTags(payload: BulkDeleteRequest): Promise<BulkDeleteResponse> {
  return request<BulkDeleteResponse>("/tags/bulk-delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function fetchCompareList(): Promise<LibraryItem[]> {
  return request<LibraryItem[]>("/compare-list")
}

export function addToCompareList(payload: AddToCompareListRequest): Promise<void> {
  return request<void>("/compare-list", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function removeFromCompareList(id: number): Promise<void> {
  return request<void>(`/compare-list/${id}`, { method: "DELETE" })
}

export function clearCompareList(): Promise<void> {
  return request<void>("/compare-list", { method: "DELETE" })
}

export function fetchArtists(): Promise<Artist[]> {
  return request<Artist[]>("/artists")
}

export function createArtist(payload: CreateArtistRequest): Promise<{ id: number }> {
  return request<{ id: number }>("/artists", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateArtist(id: number, payload: UpdateArtistRequest): Promise<void> {
  return request<void>(`/artists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteArtist(id: number): Promise<void> {
  return request<void>(`/artists/${id}`, { method: "DELETE" })
}

export function bulkDeleteArtists(payload: BulkDeleteRequest): Promise<BulkDeleteResponse> {
  return request<BulkDeleteResponse>("/artists/bulk-delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function fetchArtistImageCandidates(artistId: number): Promise<{ candidates: ArtistImageCandidate[] }> {
  return request<{ candidates: ArtistImageCandidate[] }>(`/artists/${artistId}/image-candidates`)
}

export function fetchArtistImages(artistId: number): Promise<ArtistImage[]> {
  return request<ArtistImage[]>(`/artists/${artistId}/images`)
}

export function addArtistImage(artistId: number, payload: SetArtistImageRequest): Promise<ArtistImage> {
  return request<ArtistImage>(`/artists/${artistId}/images`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteArtistImage(artistId: number, imageId: number): Promise<void> {
  return request<void>(`/artists/${artistId}/images/${imageId}`, { method: "DELETE" })
}

export function selectArtistImage(artistId: number, imageId: number): Promise<void> {
  return request<void>(`/artists/${artistId}/images/${imageId}/select`, { method: "POST" })
}

export function clearArtistSelectedImage(artistId: number): Promise<void> {
  return request<void>(`/artists/${artistId}/selected-image`, { method: "DELETE" })
}

export function listSubscriptions(): Promise<Subscription[]> {
  return request<Subscription[]>("/subscriptions")
}

export function createSubscription(payload: CreateSubscriptionRequest): Promise<Subscription> {
  return request<Subscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateSubscription(id: number, payload: UpdateSubscriptionRequest): Promise<Subscription> {
  return request<Subscription>(`/subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deleteSubscription(id: number): Promise<void> {
  return request<void>(`/subscriptions/${id}`, { method: "DELETE" })
}

export function checkSubscriptionNow(id: number): Promise<CheckSubscriptionResult> {
  return request<CheckSubscriptionResult>(`/subscriptions/${id}/check`, { method: "POST" })
}

export function listSubscriptionEntries(id: number): Promise<SubscriptionEntry[]> {
  return request<SubscriptionEntry[]>(`/subscriptions/${id}/entries`)
}

export function addSubscriptionEntry(id: number, sourceId: string, mode: AddSubscriptionEntryMode): Promise<AddSubscriptionEntryResult> {
  return request<AddSubscriptionEntryResult>(`/subscriptions/${id}/entries/${encodeURIComponent(sourceId)}/add`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  })
}

export function markSubscriptionEntrySeen(id: number, sourceId: string): Promise<void> {
  return request<void>(`/subscriptions/${id}/entries/${encodeURIComponent(sourceId)}/seen`, { method: "POST" })
}

export function linkSubscriptionEntry(id: number, sourceId: string, libraryItemId: number): Promise<void> {
  return request<void>(`/subscriptions/${id}/entries/${encodeURIComponent(sourceId)}/link`, {
    method: "POST",
    body: JSON.stringify({ libraryItemId }),
  })
}

export function unlinkSubscriptionEntry(id: number, sourceId: string): Promise<void> {
  return request<void>(`/subscriptions/${id}/entries/${encodeURIComponent(sourceId)}/unlink`, { method: "POST" })
}

export interface ThumbnailEnhancementHistoryParams {
  q?: string
  status?: string
  trigger?: string
  mode?: string
  page?: number
}

export function listThumbnailEnhancementHistory(
  params: ThumbnailEnhancementHistoryParams = {},
): Promise<ThumbnailEnhancementHistoryListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.status) search.set("status", params.status)
  if (params.trigger) search.set("trigger", params.trigger)
  if (params.mode) search.set("mode", params.mode)
  if (params.page) search.set("page", String(params.page))
  const qs = search.toString()
  return request<ThumbnailEnhancementHistoryListResponse>(
    `/thumbnail-enhancement/history${qs ? `?${qs}` : ""}`,
  )
}

export function runThumbnailEnhancementNow(): Promise<RunThumbnailEnhancementResult> {
  return request<RunThumbnailEnhancementResult>("/thumbnail-enhancement/run", { method: "POST" })
}

// listThumbnailUpscalers tests against whatever URL/username/password are
// passed in — not necessarily saved yet — so the Settings tab's "Load
// models" button works before the form has been saved.
export function listThumbnailUpscalers(url: string, username: string, password: string): Promise<string[]> {
  const search = new URLSearchParams({ url })
  if (username) search.set("username", username)
  if (password) search.set("password", password)
  return request<{ upscalers: string[] }>(`/thumbnail-enhancement/upscalers?${search.toString()}`).then(
    (r) => r.upscalers,
  )
}

export function getThumbnailEnhancementStatus(): Promise<ThumbnailEnhancementStatus> {
  return request<ThumbnailEnhancementStatus>("/thumbnail-enhancement/status")
}

export function getProxyStatus(): Promise<ProxyStatus> {
  return request<ProxyStatus>("/proxy/status")
}

export function listThumbnailEnhancementEligible(): Promise<ThumbnailEnhancementEligibleItem[]> {
  return request<ThumbnailEnhancementEligibleItem[]>("/thumbnail-enhancement/eligible")
}

export function enhanceThumbnailItems(itemIds: number[]): Promise<RunThumbnailEnhancementResult> {
  return request<RunThumbnailEnhancementResult>("/thumbnail-enhancement/items/bulk-run", {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  })
}

// sharpenThumbnailItems runs a denoise/detail-only pass (no resize) — the
// Library toolbar's "Sharpen Thumbnail(s)…" bulk action and an item's
// single-item "Sharpen Thumbnail" menu entry both call this.
export function sharpenThumbnailItems(itemIds: number[]): Promise<RunThumbnailEnhancementResult> {
  return request<RunThumbnailEnhancementResult>("/thumbnail-enhancement/items/bulk-sharpen", {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  })
}

export function revertThumbnailOriginal(id: number): Promise<void> {
  return request<void>(`/thumbnail-enhancement/items/${id}/revert`, { method: "POST" })
}

export function deleteThumbnailOriginal(id: number): Promise<void> {
  return request<void>(`/thumbnail-enhancement/items/${id}/original`, { method: "DELETE" })
}

export function bulkDeleteThumbnailOriginals(itemIds: number[]): Promise<BulkThumbnailOriginalsResponse> {
  return request<BulkThumbnailOriginalsResponse>("/thumbnail-enhancement/items/bulk-keep-enhanced", {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  })
}

export function bulkRevertThumbnailOriginals(itemIds: number[]): Promise<BulkThumbnailOriginalsResponse> {
  return request<BulkThumbnailOriginalsResponse>("/thumbnail-enhancement/items/bulk-keep-original", {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  })
}

export function deleteThumbnailEnhancementHistoryEntry(id: number): Promise<void> {
  return request<void>(`/thumbnail-enhancement/history/${id}`, { method: "DELETE" })
}

export function bulkDeleteThumbnailEnhancementHistoryEntries(ids: number[]): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/thumbnail-enhancement/history/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })
}

export function clearThumbnailEnhancementHistory(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/thumbnail-enhancement/history/clear", { method: "POST" })
}
