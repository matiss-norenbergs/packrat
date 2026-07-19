# Architecture

Packrat's backend is a Go/Gin service with SQLite (WAL mode) storage; the frontend is a
React/TypeScript SPA served by the same binary in production. See the root
[`docker-app-plan.md`](../../docker-app-plan.md) for the original long-term spec/vision doc — this
document covers what's actually implemented today, which has grown well past that document's
"working skeleton" starting point.

## Backend package layout

```
backend/
  cmd/server/main.go     entrypoint: config, DB, migrations, queue, WS hub, cleanup sweeps, HTTP server
  internal/
    config/               env-var configuration
    db/                    SQLite connection (WAL, busy_timeout) + migration runner
    models/                domain structs (Download, LibraryItem, Collection, Tag, Artist, Settings, ...)
    repository/            database/sql-based repositories, no ORM
    downloader/             yt-dlp subprocess wrapper: metadata fetch, args, progress parsing, thumbnail fetch
    queue/                  worker-pool DownloadManager + in-memory ProgressStore
    api/                    Gin router, handlers, DTOs
    ws/                     WebSocket hub/client, event types
    backup/                 export/import envelopes, encryption, settings + library bundles
    importer/               media-root scanning + ffprobe-based file import
    jellyfin/                Jellyfin client + refresh debouncer
    nfo/                     .nfo sidecar XML generation
    pathsafe/                path traversal prevention (collections, folders, imports)
    fsutil/                  filename sanitization, atomic rename pairs, directory helpers
```

## API routes live under `/api`

The frontend has client-side routes named `/downloads`, `/library`, `/collections`, etc. — the same
names as several REST resources. Registering the API at those exact top-level paths meant a hard
refresh (or a shared link) on those pages returned raw JSON instead of the app shell, since Gin
matches a registered route before ever falling back to serving `index.html`. All JSON API routes
are grouped under `/api` (see `internal/api/router.go`) to make that collision structurally
impossible, no matter how many more pages are added later. `/media-files` and `/ws` stay
unprefixed since no frontend route shares those names.

## Auth and CSRF

The app is single-user (no registration beyond a one-time setup wizard) but is fully
session-gated: `RequireAuth` covers every `/api/*` route except `/api/health` and
`/api/auth/{status,setup,login,logout}`, plus `/media-files/*` and `/ws`. Sessions are opaque
64-char hex tokens validated against a server-side sessions table (not signed/stateless JWTs),
30-day expiry, cookie `packrat_session` (`HttpOnly`, `SameSite=Lax`).

`Secure=false` is deliberate, not an oversight — the app is commonly run over plain HTTP on a
trusted LAN, and requiring HTTPS would break that default deployment. CSRF is handled separately
via a double-submit cookie (`packrat_csrf`, readable by JS, echoed back as `X-CSRF-Token` on every
mutating request) rather than relying on cookie security flags alone. See
[`api.md`](api.md#auth-and-csrf) for the full mechanics.

## Collection root paths stay under `MEDIA_ROOT`

The original spec's Collections examples show absolute paths (`/media/music`), Sonarr-root-folder
style. Since only one Docker volume is mounted, letting the Collections API accept arbitrary
absolute filesystem paths would be a straightforward arbitrary-file-write primitive. A
collection's `rootPath` is instead validated exactly like a download's `folder` field, via
`pathsafe.ResolveUnderRoot(MediaRoot, rootPath)`: it's a named folder preset *under* `MEDIA_ROOT`,
not an arbitrary path. When a download specifies both a collection and a `folder`, the folder
resolves as a subfolder within that collection's root (nested `ResolveUnderRoot` calls). The same
function backs collection creation, download folder resolution, move, and import.

## Concurrency limit is runtime-editable

`DownloadManager.SetWorkerCount` resizes the worker pool live — each worker has its own `stop`
channel that only gates whether it picks up its *next* job, while every in-flight download derives
its context from a single stable `rootCtx` set once in `Start`. Shrinking the pool (e.g. via
`PATCH /api/settings`) never cancels a download that's already running; it just stops that many
workers from claiming new jobs. The setting is persisted via `SettingsRepo` and re-read at startup,
so a saved value survives a restart instead of reverting to the `MAX_CONCURRENT_DOWNLOADS` env var.

A separate `downloadTimeoutMinutes` setting (0 = no limit) derives each download's context from
`rootCtx` with a deadline; a run that exceeds it is killed and classified as a timeout-flavored
failure rather than a generic error.

## Data flow (single download, end to end)

1. `POST /downloads` validates the request, resolves the destination folder against `MEDIA_ROOT`
   via `pathsafe.ResolveUnderRoot`, inserts a `queued` row, and pushes the ID onto the queue
   manager's job channel.
2. A worker goroutine (one of `maxConcurrentDownloads`) picks up the job, fetches metadata via
   `yt-dlp --dump-json`, then runs the actual download with `--progress-template` emitting
   structured progress lines.
3. Progress is kept in an in-memory `ProgressStore` and flushed to SQLite only on status change —
   the DB is never written to on every progress tick.
4. `progress`/`completed`/`failed`/`queue_update` events are broadcast over WebSocket, throttled to
   roughly once per second per download.
5. On success, a `library` row is created (with any `tags`/override fields from the request
   applied), an `.nfo` sidecar is written if enabled, a Jellyfin refresh is triggered if configured,
   and the frontend's Library page picks the new row up via the WS `completed` event triggering a
   refetch.
6. A `history` row is written for every terminal outcome (completed/failed/cancelled/interrupted),
   independent of the live queue — deleting a download's queue row never removes its history entry.

Playlist (`POST /downloads/playlist`) and batch (`POST /downloads/batch`) submissions both funnel
through the same per-item enqueue path (`enqueueDownload`), just with the entry list resolved
server-side (playlist) or supplied as an array (batch) instead of one URL at a time.

## Full-text search

The `library` table has an FTS5 virtual table (`library_fts`) kept in sync via triggers, covering
title/uploader/artist/description. `GET /api/library?q=...` queries it directly rather than a
`LIKE` scan. Pagination, sorting, and collection/year/tag filters all compose with the search query
in the same `LibraryRepo.Query` method.

## Privacy: private collections and private tags

An item is `blurred` if **either** of two independent things is true: its collection (or an
ancestor collection) is marked private, or any tag assigned to it is marked private. Collection
privacy is inheritance-aware (`CollectionsRepo.IsPrivate`/`effectivePrivacyMap`, walking the
`parentId` chain); tag privacy has no hierarchy to walk — a tag is just private or not
(`TagsRepo.HasPrivateTag`). Both are OR'd together at read time in `ListLibrary`,
`RefreshLibraryItemMetadata`, and the thumbnail handlers, so blur status always reflects current
collection/tag state rather than being cached on the item row.

## Collection-level defaults for new downloads

Two optional collection fields exist purely to save repetitive manual entry when adding files to a
collection, applied client-side when a collection is picked in the download dialogs — neither is
enforced server-side:

- **`seasonNumber`** — **direct only**. A download placed into a collection with this set
  defaults its own Season # to it; a sub-collection with no season of its own is *not* defaulted
  from an ancestor, even if one has a value. This matches "current parent collection," not a
  tree-wide inheritance search.
- **`artistId`** — **ancestor-aware**. A download placed into a collection walks up the
  `parentId` chain (starting at the selected collection itself) and defaults its Artist to the
  first one it finds set, supporting layouts like `root/some-folder/artist/season/file` where the
  artist is set several levels above where files actually land. Implemented client-side as a pure
  helper (`resolveInheritedArtistId` in `frontend/src/lib/collectionTree.ts`) over the full
  collection list already in memory — there's no server-side computed field for it, unlike
  `effectiveIsPrivate`, since it only affects a UI default-fill, not blur/access logic.

In both dialogs, selecting a *different* collection only fills the field when that collection (or,
for Artist, an ancestor) actually has a value — it never clears a value the user already typed in.

## Backup and restore

The `backup` package builds and applies two kinds of portable JSON bundles — settings and library
— each wrapped in a shared envelope (`packrat`/`version`/`kind`/`exportedAt`/`encrypted`/`data`)
optionally encrypted with a user-supplied passphrase (`backup/crypto.go`). The library bundle
never ships media bytes: it references collections/artists/tags by name/path rather than local
numeric ID (so it's portable across installs) and re-populates a library by **re-queuing
downloads** from each item's saved `originalUrl` on import, not by copying files. Import is
additive-only — it matches existing collections/tags/artists by name and creates only what's
missing, and a name collision on one entry is skipped rather than aborting the whole import.

## Crash recovery

On startup, `DownloadsRepo.MarkInterruptedIfActive` scans for rows left in `queued`,
`fetching_metadata`, `downloading`, or `processing` status (i.e. anything a crashed/restarted
process was mid-flight on) and marks them `interrupted`. Nothing is silently resumed — the user
must manually retry from the Downloads or History page.

## Retention sweeps

A background goroutine in `main.go` periodically deletes terminal (non-active) rows older than the
configured retention window for two independently-configurable settings: `historyRetentionDays`
(History page) and `downloadLogRetentionDays` (Downloads/Logs pages). `0` means keep forever for
either. Both also have a manual "clear all now" action that ignores age entirely.

## Deliberate scope cuts

Still intentionally out of scope, not forgotten:

- **No filename templating engine.** The original spec's `{title}/{channel}/{date}` template
  variables are not implemented. A blank filename uses yt-dlp's native `%(title)s`; a provided
  filename is used literally (sanitized).
- **No multi-user support.** One user account, created once via the setup wizard; there is no
  invite/second-account flow, and `POST /api/auth/setup` permanently 409s after the first user
  exists.
- **No rate limiting.** The app is intended for a trusted local network; auth/CSRF protect against
  CSRF and session theft, not brute-force or abuse from an untrusted network position. WebSocket
  has no origin restriction (`CheckOrigin` always returns true) beyond the session-cookie gate.
- **No automatic media byte transfer in backups.** By design — see "Backup and restore" above.
  A library bundle is a recipe for re-downloading, not an archive of the files themselves.
