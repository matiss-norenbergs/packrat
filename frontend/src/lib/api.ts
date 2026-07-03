import type { CreateDownloadRequest, Download, LibraryItem } from "@/types/api"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
