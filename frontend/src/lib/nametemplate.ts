// Client-side mirror of backend/internal/nametemplate — used to show a live
// "here's roughly what this will resolve to" hint, and to power the
// FilenameTemplateBuilderDialog's parse/serialize round-trip. Deliberately
// simplified (no per-segment filesystem sanitization): this is a preview,
// not the source of truth — the server always resolves the real filename
// authoritatively at download-completion time.

export type TemplateField =
  | "title"
  | "uploader"
  | "channel"
  | "date"
  | "artist"
  | "year"
  | "season"
  | "sequence"
  | "collection"

// The 8 fields offered by the builder UI — "channel" is a hand-typed-only
// alias for "uploader" (kept for backward compat with existing templates)
// and isn't offered as its own picker option since it'd just be a duplicate.
export const BUILDER_FIELDS: TemplateField[] = [
  "title",
  "artist",
  "uploader",
  "date",
  "year",
  "season",
  "sequence",
  "collection",
]

export const FIELD_LABELS: Record<TemplateField, string> = {
  title: "Title",
  uploader: "Uploader",
  channel: "Uploader",
  date: "Date",
  artist: "Artist",
  year: "Year",
  season: "Season #",
  sequence: "Sequence #",
  collection: "Collection",
}

// Fields whose value is free text (word-join modifier makes sense) vs. a
// plain integer (zero-pad modifier makes sense). "date" gets neither — it's
// already a fixed-width YYYYMMDD string from yt-dlp.
export const TEXT_FIELDS = new Set<TemplateField>(["title", "uploader", "channel", "artist", "collection"])
export const NUMERIC_FIELDS = new Set<TemplateField>(["year", "season", "sequence"])

export interface FilenameTemplateVars {
  title?: string
  uploader?: string
  uploadDate?: string
  artist?: string
  year?: string
  season?: string
  sequence?: string
  collection?: string
}

const TOKEN_PATTERN = /\{(title|uploader|channel|date|artist|year|season|sequence|collection)(?::([^}]+))?\}/g

function applyModifier(value: string, modifier: string | undefined): string {
  if (!modifier) return value
  if (/^\d+$/.test(modifier)) {
    const width = Number(modifier)
    const n = Number(value)
    if (value.trim() !== "" && Number.isFinite(n)) {
      return String(Math.trunc(n)).padStart(width, "0")
    }
    return value
  }
  return value.split(/\s+/).filter(Boolean).join(modifier)
}

export function resolveFilenameTemplatePreview(template: string, vars: FilenameTemplateVars): string {
  if (!template.trim()) return ""

  const values: Record<TemplateField, string> = {
    title: vars.title ?? "",
    uploader: vars.uploader ?? "",
    channel: vars.uploader ?? "",
    date: vars.uploadDate ?? "",
    artist: vars.artist ?? "",
    year: vars.year ?? "",
    season: vars.season ?? "",
    sequence: vars.sequence ?? "",
    collection: vars.collection ?? "",
  }

  const resolved = template.replace(TOKEN_PATTERN, (_match, field: TemplateField, modifier?: string) =>
    applyModifier(values[field], modifier),
  )

  return resolved
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" / ")
}

// --- Builder dialog support -------------------------------------------------

export type TemplateElement =
  | { id: string; kind: "token"; field: TemplateField; modifier: string }
  | { id: string; kind: "literal"; text: string }

let elementCounter = 0
function nextId(): string {
  elementCounter += 1
  return `el-${elementCounter}`
}

// Parses a template string (however it was produced — hand-typed or from a
// previous builder session) into an ordered list of token/literal elements,
// so the builder dialog can render and re-edit an existing template instead
// of always starting from scratch.
export function parseTemplate(template: string): TemplateElement[] {
  const elements: TemplateElement[] = []
  let lastIndex = 0
  const pattern = new RegExp(TOKEN_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ id: nextId(), kind: "literal", text: template.slice(lastIndex, match.index) })
    }
    elements.push({ id: nextId(), kind: "token", field: match[1] as TemplateField, modifier: match[2] ?? "" })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < template.length) {
    elements.push({ id: nextId(), kind: "literal", text: template.slice(lastIndex) })
  }
  return elements
}

export function serializeTemplate(elements: TemplateElement[]): string {
  return elements
    .map((el) => (el.kind === "literal" ? el.text : el.modifier ? `{${el.field}:${el.modifier}}` : `{${el.field}}`))
    .join("")
}
