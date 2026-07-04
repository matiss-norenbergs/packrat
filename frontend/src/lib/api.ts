import type {
  Collection,
  CreateCollectionRequest,
  CreateDownloadRequest,
  Download,
  ImportRequest,
  LibraryItem,
  MoveLibraryItemRequest,
  ScannedFile,
  Settings,
  ThumbnailCandidate,
  UpdateCollectionRequest,
  UpdateLibraryItemRequest,
  UpdateSettingsRequest,
} from "@/types/api"

// All JSON API routes live under /api (kept distinct from the frontend's
// client-side routes of the same name, e.g. /downloads and /library — see
// backend/internal/api/router.go).
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
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

export function cancelDownload(id: number): Promise<void> {
  return request<void>(`/downloads/${id}`, { method: "DELETE" })
}

export function fetchLibrary(): Promise<LibraryItem[]> {
  return request<LibraryItem[]>("/library")
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

export function fetchImportScan(): Promise<ScannedFile[]> {
  return request<ScannedFile[]>("/import/scan")
}

export function createImport(payload: ImportRequest): Promise<LibraryItem> {
  return request<LibraryItem>("/import", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
