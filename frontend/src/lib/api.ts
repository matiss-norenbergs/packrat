import type {
  Artist,
  AuthStatus,
  BulkAssignTagsRequest,
  ChangePasswordRequest,
  Collection,
  CreateArtistRequest,
  CreateBatchDownloadRequest,
  CreateCollectionRequest,
  CreateDownloadRequest,
  CreatePlaylistDownloadRequest,
  Download,
  DownloadPreview,
  EnqueueResult,
  HistoryItem,
  ImportRequest,
  LibraryFacets,
  LibraryItem,
  LibraryListResponse,
  LibraryQueryParams,
  LoginRequest,
  LogEntry,
  MoveLibraryItemRequest,
  ScannedFile,
  Settings,
  SetupRequest,
  Stats,
  Tag,
  ThumbnailCandidate,
  CreateTagRequest,
  UpdateArtistRequest,
  UpdateCollectionRequest,
  UpdateLibraryItemRequest,
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
  if (params.year != null) search.set("year", String(params.year))
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","))
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

export function deleteLibraryItem(id: number, deleteFiles: boolean): Promise<void> {
  return request<void>(`/library/${id}?deleteFiles=${deleteFiles}`, { method: "DELETE" })
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

export function moveLibraryItem(id: number, payload: MoveLibraryItemRequest): Promise<void> {
  return request<void>(`/library/${id}/move`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function refreshLibraryItemMetadata(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/refresh-metadata`, { method: "POST" })
}

export function redownloadLibraryItem(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/library/${id}/redownload`, { method: "POST" })
}

export function redownloadLibraryThumbnail(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail/redownload`, { method: "POST" })
}

export function quickGrabLibraryThumbnail(id: number): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail/quick-grab`, { method: "POST" })
}

export function fetchLibraryThumbnailCandidates(id: number): Promise<{ candidates: ThumbnailCandidate[] }> {
  return request<{ candidates: ThumbnailCandidate[] }>(`/library/${id}/thumbnail/candidates`)
}

export function setLibraryThumbnail(id: number, imageBase64: string): Promise<LibraryItem> {
  return request<LibraryItem>(`/library/${id}/thumbnail`, {
    method: "POST",
    body: JSON.stringify({ imageBase64 }),
  })
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

export function fetchStats(): Promise<Stats> {
  return request<Stats>("/stats")
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
