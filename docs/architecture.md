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
    backup/                 export/import envelopes, encryption, settings + library + full bundles,
                             scheduled/history-tracked backup runner
    importer/               media-root scanning + ffprobe-based file import
    jellyfin/                Jellyfin client + refresh debouncer
    nfo/                     .nfo sidecar XML generation
    pathsafe/                path traversal prevention (collections, folders, imports)
    fsutil/                  filename sanitization, atomic rename pairs, directory helpers
    imageproc/               shared ffmpeg-based WebP derivative generation + dimension probing,
                             used by library thumbnails, collection covers, and artist images;
                             also full-resolution format conversion for downloadType=image
    imagefetch/               plain-HTTP fetch for downloadType=image (no yt-dlp involved) and the
                             New Download dialog's proxied preview passthrough — both proxy-aware
                             via the same ytdlp_proxy setting yt-dlp itself reads
    imagebackfill/           one-off background sweep: regenerates missing derivatives and
                             backfills thumbnail dimensions for pre-existing rows
    framematch/              perceptual-hash frame matching (ad-hoc job store + durable queue)
    subscriptions/           periodic channel/playlist re-check + ghost/download creation
    thumbnailenhance/        AI upscale/sharpen via a self-hosted Stable Diffusion instance
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

## `downloadType=image`: a direct-URL download with no `yt-dlp` involved

`yt-dlp`'s extractors are built for video-hosting pages, not a bare link straight to an image file —
rather than stretch it to fit, `imagefetch.Fetch` does a plain HTTP GET (Content-Type validated
against an allowlist, written atomically via temp-file-then-rename). `queue.DownloadManager.runOne`
forks on `d.DownloadType == "image"` at exactly two points: the metadata-fetch step (skipped
entirely — `titleFromURL` derives a fallback title from the URL itself) and the actual
fetch/download step (`runImageDownload` instead of `ytdlp.Run`). Everything after that — duplicate
detection, thumbnail-tier generation (the image doubles as its own thumbnail), redownload, the
queue's progress model — is unmodified, since both paths converge back onto the same
`downloader.RunResult` shape.

**Proxy routing.** yt-dlp reads the `ytdlp_proxy` setting via its own `--proxy` flag, but a plain
`http.Client` fetch doesn't get that for free — `imagefetch.Fetch`/`imagefetch.Open` both take a
`proxyURL` parameter and build an `http.Transport{Proxy: http.ProxyURL(...)}` from it, reusing the
exact setting value/scheme convention (`socks5://`/`http://`/`https://`) yt-dlp already uses. This
matters beyond just the real download: the New Download dialog's live preview `<img>` — for an
image-type URL *and* for a regular video/audio URL's yt-dlp-reported thumbnail — used to be a raw
client-side `<img src>` pointing straight at the external URL, which has no way to honor a
backend-configured proxy at all. `GET /api/downloads/preview-image` (`imagefetch.Open`, streaming
instead of writing to disk) fixes both at once: the frontend's `previewImageUrl()` helper rewrites
every preview `<img src>` to go through this endpoint rather than the raw external URL, so a preview
never leaks outside whatever network path the real download would use. `GET /api/proxy/status`
(a short-timeout `HEAD` through the configured transport) backs the sidebar's live reachability dot,
independent of any actual download or preview happening.

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
collection/tag state rather than being cached on the item row. The compare list endpoint
(`ListCompareList`) reuses this exact same resolution, so a private item shows blurred in the
compare grid too, gated by the same reveal-all mechanism.

## Ghost items are not a separate table

A ghost item is just a `library` row with `status="ghost"` and empty `filename`/`path` (the same
empty-string sentinel `LibraryRepo.ClearFile` uses elsewhere) — no schema change was needed to
support them. Three independent paths converge on this state: creating one directly
(`CreateGhostLibraryItem`), deleting just a real item's file (`DeleteLibraryItemFile`/
`ClearFile`), or the on-demand `scan-missing` sweep finding a file gone from disk.
`fetchGhostThumbnail` (`ghost_handler.go`) is shared between ghost creation and the Library
toolbar's bulk "Download thumbnail(s)" action — it always writes only the `ImagesRoot`-relative
WebP tiers, never the `MediaRoot`-relative `thumbnail` field, since a ghost has no `MediaRoot`
location to anchor a sidecar file to.

## Thumbnail/image derivatives

`imageproc.GenerateTiers`/`GenerateTiersFromPath` (ffmpeg shell-out, never a cgo image library) is
the one shared pipeline behind every resized-image feature in the app: library thumbnails
(small/medium), collection covers (small/medium/original), and artist images (a single 400px
tier). Collection-cover and artist-image writes additionally share a common dual-source request
pattern (`sourceRelPath` — an existing file under `MEDIA_ROOT` — or `imageBase64`+`filename`, a
fresh upload) via `resolveImageSourceBytes` (`internal/api/image_source.go`). All of these
derivatives live under a separate `ImagesRoot`/`/local-images/*` static tree, distinct from
`MEDIA_ROOT`/`/media-files/*`.

A library item's **original** sidecar thumbnail's pixel dimensions (`thumbnail_width`/
`thumbnail_height` columns) are probed once, header-only (`image.DecodeConfig` — no full pixel
decode), whenever the original file is (re)written — set, redownloaded, imported, enhanced, applied
from the gallery or a frame match, etc. — and persisted alongside the small/medium derivative
paths. This avoids the frontend ever loading an image client-side just to read its size. There's no
single funnel every write path shares (`writeThumbnailAndRespond` only covers the four gin-routed
thumbnail endpoints), so the probe is duplicated at each of the ~9 independent write sites rather
than centralized. Pre-existing rows are backfilled via the `imagebackfill` sweep. These two columns
are deliberately excluded from `backup.LibraryItemEntry` — a disposable derived value, not worth
including in a portable export.

The **thumbnail gallery** (`thumbnail_gallery` table, `ON DELETE CASCADE` with the library item) is
a separate, per-item list of saved candidate images, independent of the one active thumbnail —
populated from "Save in Thumbnail Gallery," a specific frame from "Choose from Video," or a Frame
Matching result. `readCurrentThumbnail` (`thumbnail_gallery_handler.go`) falls back from the
full-res `MediaRoot` original to the best available `ImagesRoot` derivative, so even a ghost item's
URL-fetched thumbnail (which only ever gets derivative tiers) can be saved to its gallery. Applying
a gallery image reuses the same `writeThumbnailAndRespond` finish path as `SetLibraryThumbnail` and
Frame Matching's accept action, keeping derivatives and stale AI-enhancement backups consistent
across all three thumbnail-setting entry points.

## Frame matching

`internal/framematch` finds the video frame that best perceptually matches a reference image
(pHash: a coarse 1fps sweep, then a fine windowed pass around the top candidates) — not duplicate
detection. Two independently-triggered paths share the same `Match()` core and a package-level
mutex that serializes every match regardless of trigger, since the CPU-bound ffmpeg decode
shouldn't run two-at-once on a resource-capped container:

- An in-memory, non-persistent `framematch.JobStore` backs the single-item ad-hoc endpoint — a job
  vanishes on server restart.
- The `frame_match_queue` table plus `framematch.RunQueue`, a single long-lived background
  goroutine started once at server boot, polls the table and processes rows one at a time — backs
  the bulk action and the Frame Matching review page. Accepting or discarding a row deletes it
  (a working queue, not a history).

`ResolveReferenceImage` is shared by both paths so `"url"`/`"current"` mode resolves identically
either way; it deliberately avoids `YtDlpService.FetchThumbnail`'s `--convert-thumbnails`
postprocessor (known to fail silently on AVIF) in favor of an explicit fetch-raw-then-decode step.

## Subscriptions

`internal/subscriptions` periodically re-checks a saved channel/playlist URL and, for each
genuinely new upload, either enqueues a real download (`AutoDownload` on) or creates a ghost
placeholder (off) — reusing the ghost-creation and download-enqueue *logic*, but **not the code**:
`checker.go`'s comment is explicit that this is a deliberate duplication to avoid an import cycle
(package `api` already imports `subscriptions` to expose the "check now" endpoint, so the reverse
import isn't possible). Downloads triggered this way go through the exact same
`queue.DownloadManager.Enqueue` as every other download source — same live queue, same WebSocket
progress events, same worker-pool concurrency limit. Subscribing baselines every currently-existing
upload as already-seen (`BaselineOnCreate`) without creating anything, so a new subscription only
ever surfaces uploads from that point forward. There is no per-subscription goroutine/ticker — see
Retention sweeps below.

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

The `backup` package builds and applies **three** kinds of portable JSON bundle — settings,
library, and `full` (settings + library combined) — each wrapped in a shared envelope
(`packrat`/`version`/`kind`/`exportedAt`/`encrypted`/`data`) optionally encrypted with a
user-supplied passphrase (`backup/crypto.go`). `full` isn't a separate data model: `BuildFullBundle`
just calls the existing `BuildSettingsBundle`/`BuildLibraryBundle` verbatim and wraps both under one
envelope. The settings/library import endpoints were widened to accept `kind: "full"` in addition
to their own (`OpenAny`, checking membership in an allowed-kinds list instead of one exact kind) and
just pull out their own half — so a full-kind file can be fed into any of the three import entry
points, not only the dedicated one. The library bundle never ships media bytes: it references
collections/artists/tags by name/path rather than local numeric ID (so it's portable across
installs) and re-populates a library by **re-queuing downloads** from each item's saved
`originalUrl` on import (or recreating it as a ghost placeholder, in `ghostOnly` mode), not by
copying files. Import is additive-only — it matches existing collections/tags/artists by name and
creates only what's missing, and a name collision on one entry is skipped rather than aborting the
whole import.

`backup.RunBackup`/`RunScheduledBackupIfDue` (`backup/auto.go`) is a second, disk-resident path
layered on top of the same bundle builders — it always writes an **unencrypted** `full` bundle to
`BackupsRoot` (there's nowhere to prompt for a password unattended) and records a `backup_history`
row for every attempt, success or failure, so the history table doubles as a health check. It isn't
a dedicated cron: "due" is checked on the same shared hourly sweep described in Retention sweeps
below, so worst-case drift from the configured interval is under an hour. Old backups are pruned to
a configurable retention count after every run.

## Crash recovery

On startup, `DownloadsRepo.MarkInterruptedIfActive` scans for rows left in `queued`,
`fetching_metadata`, `downloading`, or `processing` status (i.e. anything a crashed/restarted
process was mid-flight on) and marks them `interrupted`. Nothing is silently resumed — the user
must manually retry from the Downloads or History page.

## Retention sweeps

A single shared hourly ticker in `main.go` (`historyCleanupInterval = time.Hour`) drives five
independent, sequential, no-op-if-not-due sweeps per tick — one goroutine, not five separate
tickers: history/download-log retention, thumbnail-enhancement history cleanup, due subscription
checks (`subscriptions.RunDueChecks`), and due scheduled backups
(`backup.RunScheduledBackupIfDue`). History/log retention deletes terminal (non-active) rows older
than two independently-configurable settings — `historyRetentionDays` (History page) and
`downloadLogRetentionDays` (Downloads/Logs pages), `0` meaning keep forever — each with a manual
"clear all now" action that ignores age entirely. Hourly granularity is deliberate: the smallest
configurable subscription/backup interval is 6h, so checking hourly is more than sufficient
resolution without needing per-feature scheduling infrastructure.

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
- **No image galleries/site scraping.** `downloadType=image` is deliberately scoped to one direct
  link → one file, no `gallery-dl`-style multi-image-per-post extraction. Ghost items and
  subscriptions also don't gain image support — both stay `video`|`audio`-only by design, even
  though `Collection.defaultDownloadType` itself now also accepts `image`.
