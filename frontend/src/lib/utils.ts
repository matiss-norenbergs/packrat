import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "—"
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatEta(seconds: number): string {
  if (seconds == null || seconds < 0) return "—"
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  fetching_metadata: "Fetching Metadata",
  downloading: "Downloading",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  duplicate: "Duplicate",
}

export function formatDownloadStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1)
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".flac", ".wav", ".aac", ".ogg", ".opus"])

// Mirrors the audio half of the importer's recognizedExtensions allowlist
// (backend/internal/importer/scan.go) — there's no downloadType/isAudio
// field on LibraryItem, so the player has to infer it from the filename.
export function isAudioFilename(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  if (dot === -1) return false
  return AUDIO_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

// Deterministic, non-cryptographic hash (FNV-1a) used to mask a private
// item's display name — same input always produces the same placeholder, so
// a re-render (or another browser) doesn't shuffle it, without needing an
// async crypto.subtle call just to obscure text that's already sitting in
// the API response (same trust model as the blurred thumbnail: obscured at
// a glance, not actually hidden from the payload).
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return "Hidden-" + (hash >>> 0).toString(16).padStart(8, "0")
}

// Triggers a browser "save file" for an in-memory object — the export
// endpoints just return normal JSON, so "download" is purely this
// client-side step rather than anything server-driven.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
