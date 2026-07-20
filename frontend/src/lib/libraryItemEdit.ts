import { NO_ARTIST } from "@/components/library/ArtistSelect"
import type { LibraryItem, UpdateLibraryItemRequest } from "@/types/api"

export interface LibraryItemEditFields {
  title: string
  filename: string // without extension
  uploader: string
  artistId: string // NO_ARTIST sentinel or numeric string
  year: string
  seasonNumber: string
  sequenceNumber: string
  description: string
  originalUrl: string
  tags: string[]
  generateNfo: boolean
}

export function baseNameWithoutExt(filename: string): string {
  const idx = filename.lastIndexOf(".")
  return idx > 0 ? filename.slice(0, idx) : filename
}

export function artistIdToSelectValue(artistId: number | null): string {
  return artistId != null ? String(artistId) : NO_ARTIST
}

// Builds an item's fields from its current server state — the starting point
// for both the single-item Edit dialog and each row of the bulk Edit dialog.
export function libraryItemToEditFields(item: LibraryItem): LibraryItemEditFields {
  return {
    title: item.title,
    filename: baseNameWithoutExt(item.filename),
    uploader: item.uploader ?? "",
    artistId: artistIdToSelectValue(item.artistId),
    year: item.year != null ? String(item.year) : "",
    seasonNumber: item.seasonNumber != null ? String(item.seasonNumber) : "",
    sequenceNumber: item.sequenceNumber != null ? String(item.sequenceNumber) : "",
    description: item.description ?? "",
    originalUrl: item.originalUrl ?? "",
    tags: item.tags,
    generateNfo: item.generateNfo,
  }
}

// Diffs `fields` against `item`'s original values and returns only what
// actually changed — the same partial-merge payload UpdateLibraryItemRequest
// expects. Used by the single-item Edit dialog (one call) and each row of the
// bulk Edit dialog (one call per row, independently).
export function buildLibraryItemUpdatePayload(item: LibraryItem, fields: LibraryItemEditFields): UpdateLibraryItemRequest {
  const payload: UpdateLibraryItemRequest = {}

  const trimmedTitle = fields.title.trim()
  if (trimmedTitle && trimmedTitle !== item.title) payload.title = trimmedTitle

  const trimmedFilename = fields.filename.trim()
  if (trimmedFilename && trimmedFilename !== baseNameWithoutExt(item.filename)) payload.filename = trimmedFilename

  const trimmedUploader = fields.uploader.trim()
  if (trimmedUploader !== (item.uploader ?? "")) payload.uploader = trimmedUploader

  const initialArtistId = artistIdToSelectValue(item.artistId)
  if (fields.artistId !== initialArtistId) payload.artistId = fields.artistId === NO_ARTIST ? 0 : Number(fields.artistId)

  const parsedYear = fields.year.trim() === "" ? null : Number(fields.year)
  if (parsedYear !== item.year && parsedYear != null && !Number.isNaN(parsedYear)) {
    payload.year = parsedYear
  }

  const parsedSequenceNumber = fields.sequenceNumber.trim() === "" ? null : Number(fields.sequenceNumber)
  if (parsedSequenceNumber !== item.sequenceNumber && parsedSequenceNumber != null && !Number.isNaN(parsedSequenceNumber)) {
    payload.sequenceNumber = parsedSequenceNumber
  }

  const parsedSeasonNumber = fields.seasonNumber.trim() === "" ? null : Number(fields.seasonNumber)
  if (parsedSeasonNumber !== item.seasonNumber && parsedSeasonNumber != null && !Number.isNaN(parsedSeasonNumber)) {
    payload.seasonNumber = parsedSeasonNumber
  }

  const trimmedDescription = fields.description.trim()
  if (trimmedDescription !== (item.description ?? "")) payload.description = trimmedDescription

  const trimmedOriginalUrl = fields.originalUrl.trim()
  if (trimmedOriginalUrl !== (item.originalUrl ?? "")) payload.originalUrl = trimmedOriginalUrl

  // Array identity won't work for the diff — compare contents, not order.
  const tagsKey = (arr: string[]) => [...arr].sort().join("|")
  if (tagsKey(fields.tags) !== tagsKey(item.tags)) payload.tags = fields.tags

  if (fields.generateNfo !== item.generateNfo) payload.generateNfo = fields.generateNfo

  return payload
}
