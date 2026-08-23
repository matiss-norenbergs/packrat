# API

Base URL: same origin as the web UI (the Go binary serves both the API and the built frontend).
This is a **solo-admin app** — there is never more than one user account. All timestamps are
RFC3339. Unless noted, error responses are `{"error": "..."}`.

All JSON API routes live under `/api` — this is deliberate, not a style choice: the frontend has
client-side routes named `/downloads`, `/library`, `/collections`, etc. too, and without the prefix
a hard refresh (or a shared link) on those pages would hit the API route instead of the app shell,
since Gin matches registered routes before falling back to serving `index.html`. `/media-files` and
`/ws` stay unprefixed since no frontend route shares those names.

## Auth and CSRF

- **Session**: an opaque 64-char hex token in cookie `packrat_session` (`HttpOnly`, `SameSite=Lax`,
  `Secure=false` — deliberate, since the app is commonly run over plain HTTP on a LAN). 30-day
  expiry, validated server-side against a sessions table — not a signed/stateless token.
- **`RequireAuth`** gates every `/api/*` route except `/api/health` and
  `/api/auth/{status,setup,login,logout}`, plus `/media-files/*` and `/ws`. Missing/invalid session
  → `401`.
- **CSRF**: double-submit cookie. Cookie `packrat_csrf` (`HttpOnly=false` so JS can read it, same
  value as the session token, set/cleared alongside it on login/setup/logout). Every mutating
  request (anything but GET/HEAD/OPTIONS) under the authenticated `/api` group must echo that value
  back in an `X-CSRF-Token` header, or the request gets a `403`.
- **First run**: `GET /api/auth/status` returns `{setupRequired, authenticated}`. While
  `setupRequired`, the client shows a setup wizard that `POST`s `/api/auth/setup` once; after that,
  setup always `409`s — there is no way to add a second user.

## Health

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | public |

`200 {"status":"ok"}`, or `503 {"status":"unhealthy","error":"..."}` on a database ping failure.

## Auth

| Method | Path | Auth |
|---|---|---|
| GET | `/api/auth/status` | public |
| POST | `/api/auth/setup` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| PATCH | `/api/auth/password` | session + CSRF |

- **`POST /api/auth/setup`** — `{ "username": "...", "password": "min 8 chars" }`. Only succeeds
  while zero users exist (`409` otherwise). Creates the user, sets both cookies, `204`.
- **`POST /api/auth/login`** — `{ "username": "...", "password": "..." }`. Wrong username *or*
  password both return `401 {"error":"invalid username or password"}` — never reveals which was
  wrong. `204` on success, sets both cookies.
- **`POST /api/auth/logout`** — no body. Deletes the session row server-side (a replayed old cookie
  stops working immediately) and clears both cookies. `204`, idempotent even with no session.
- **`PATCH /api/auth/password`** — `{ "currentPassword": "...", "newPassword": "min 8 chars" }`.
  Requires the *current* password even though the route is already session-protected, so a
  hijacked/left-open session can't lock out the real owner. `401` if current password is wrong,
  else `204`.

## Downloads

| Method | Path | Description |
|---|---|---|
| POST | `/api/downloads` | Queue a single download |
| GET | `/api/downloads` | List the live queue (all statuses, not paginated) |
| POST | `/api/downloads/preview` | Fetch yt-dlp metadata without queuing anything |
| GET | `/api/downloads/preview-image` | Proxy a single external image through the backend |
| POST | `/api/downloads/playlist` | Queue a playlist URL — server expands entries |
| POST | `/api/downloads/batch` | Queue many independent URLs in one call |
| POST | `/api/downloads/:id/cancel` | Cancel a queued/in-flight download |
| DELETE | `/api/downloads/:id` | Remove a terminal download's queue-history row |
| POST | `/api/downloads/clear-log` | Delete every terminal download row now |

### `POST /api/downloads` — body

```json
{
  "url": "https://www.youtube.com/watch?v=abc123",
  "collectionId": 4,
  "folder": "",
  "filename": "",
  "downloadType": "video",
  "quality": "1080p",
  "audioFormat": "mp3",
  "title": null,
  "artistId": null,
  "year": null,
  "seasonNumber": null,
  "sequenceNumber": null,
  "filenamePrefix": null,
  "tags": ["music", "live"],
  "generateNfo": true
}
```

`url` (must be a URL) and `downloadType` (`video`|`audio`|`image`) are required; everything else is
optional. Notes:

- If `collectionId` is set and `quality` is omitted, the collection's `defaultQuality` is used;
  else the app-wide `defaultQuality` setting; else `"best"`.
- `audioFormat` defaults to `"mp3"` when `downloadType=audio` and it's omitted. Every path that can
  queue an audio download (this endpoint, batch/playlist, and subscriptions) applies this same
  default — yt-dlp rejects an empty `--audio-format` outright.
- `folder`/`collectionId` are validated with path-traversal protection *synchronously* — an
  invalid folder or unknown collection is a `400`, not a later async failure.
- `title`/`artistId`/`year`/`seasonNumber`/`sequenceNumber`/`filenamePrefix` are **overrides
  applied once the download completes**, taking priority over whatever yt-dlp reports.
- `tags` are applied to the resulting library item on completion (created if missing).
- Response: `201 {"id": 42}`.
- **`downloadType=image`**: for a direct link to a single image file — no yt-dlp involved at all,
  no gallery/multi-image support. Skips the metadata-fetch step entirely (the title falls back to
  the URL's last path segment, then the raw URL). The plain HTTP GET is routed through the
  `ytdlp_proxy` setting exactly like yt-dlp itself (see Proxy, below). The downloaded file is
  optionally re-encoded per the `imageConvertFormat` setting (Settings → Library; global only, no
  per-download override) and doubles as its own thumbnail — no separate sidecar. Quality/audio
  fields are ignored. A URL whose response isn't a recognized `image/*` Content-Type fails fast
  instead of writing a misleadingly-named file.

### `GET /api/downloads` — no params

Returns every queue row (any status), each merged with live in-memory progress when actively
running:

```json
{
  "id": 42, "url": "https://youtube.com/watch?v=abc123", "collectionId": 4,
  "collectionName": "Music Videos", "folder": "", "filename": "",
  "downloadType": "video", "quality": "1080p", "audioFormat": null,
  "status": "downloading", "title": "Some Video", "uploader": "Some Channel",
  "duration": 214, "thumbnail": "Music Videos/Some Video.jpg", "errorMessage": null,
  "createdAt": "2026-07-19T10:00:00Z", "updatedAt": "2026-07-19T10:00:05Z",
  "completedAt": null, "percent": 43.2, "speedBytesPerSec": 1048576,
  "etaSeconds": 12, "downloadedBytes": 5242880, "totalBytes": 12058624,
  "blurred": false
}
```

`status` is one of `queued`, `fetching_metadata`, `downloading`, `processing`, `completed`,
`failed`, `cancelled`, `interrupted`. `percent` is forced to `100` once `status=completed`.
`blurred` is true if the item's collection (or an ancestor) is private.

### `POST /api/downloads/preview`

Body: `{ "url": "https://..." }`. Fetches yt-dlp metadata for the New Download dialog's pre-submit
card — a fetch failure returns `422` and the frontend treats it as non-fatal. For a single-video
URL, also checks for a duplicate already in the library (by URL/video ID).

```json
{
  "title": "Some Video", "uploader": "Some Channel", "duration": 214,
  "thumbnail": "https://...jpg", "resolution": "1920x1080",
  "isPlaylist": false, "playlistTitle": "", "playlistCount": 0,
  "duplicate": null
}
```

For a playlist URL, `isPlaylist=true` and only `playlistTitle`/`playlistCount` are populated.

### `GET /api/downloads/preview-image?url=...`

Streams `url`'s response straight back through — same Content-Type allowlist and `ytdlp_proxy`
routing as the `downloadType=image` fetch above. Backs the New Download dialog's live preview
`<img>` for **both** an image-type URL and a regular video/audio URL's yt-dlp-reported thumbnail: a
plain client-side `<img src>` pointing at the raw external URL can't honor a backend-configured
proxy, so both preview paths go through this endpoint instead of loading the external image
directly. `422` if the fetch fails or the Content-Type isn't a recognized image type; `200` with the
image bytes streamed through (`Content-Type`/size passed along) on success.

### `POST /api/downloads/playlist`

The client sends **only a URL and a mode** — the server does a fresh yt-dlp flat-playlist fetch and
resolves entries itself, never trusting a client-supplied entry list.

```json
{
  "url": "https://youtube.com/playlist?list=xyz",
  "collectionId": 4, "downloadType": "video", "quality": "1080p",
  "playlistMode": "range", "playlistStart": 5, "playlistEnd": 10,
  "skipDuplicates": true
}
```

`playlistMode` is one of:
- `"current"` — no playlist fetch; queues exactly one download for the URL as given.
- `"entire"` — every entry.
- `"range"` — 1-based inclusive `playlistStart`..`playlistEnd`; `400` if out of bounds/missing.
- `"first_n"` — first `playlistLimit` entries (clamped to playlist length); `400` if `<1`.

Expanded entries get `sequenceNumber` auto-set to their 1-based position in the filtered list, and
duplicate matching uses the real per-entry video ID. `422` if the initial playlist fetch fails.
Response: `201` with an `EnqueueResult` (see batch, below) — same shape either way.

### `POST /api/downloads/batch`

Many independent URLs — what used to be N separate `POST /api/downloads` calls, now one request
(used by the Bulk Download dialog).

```json
{
  "items": [
    { "url": "https://youtube.com/watch?v=aaa", "downloadType": "video", "collectionId": 4 },
    { "url": "https://youtube.com/watch?v=bbb", "downloadType": "audio", "audioFormat": "mp3" }
  ],
  "skipDuplicates": true
}
```

Each item is a full `CreateDownloadRequest` (same shape as `POST /api/downloads`), individually
validated. If `skipDuplicates`, each URL is checked against the library first (by URL) and skipped
rather than re-downloaded. Response `201`:

```json
{
  "queued": [ { "id": 101, "url": "https://youtube.com/watch?v=aaa" } ],
  "skipped": [ { "url": "https://youtube.com/watch?v=bbb", "title": "Old Song", "libraryItemId": 55 } ],
  "failed": []
}
```

A per-item enqueue failure lands in `failed` (`{url, error}`) rather than aborting the whole batch.

### `POST /api/downloads/:id/cancel` — no body

`204` on success. `404` unknown id, `409` if it's not in a cancellable state.

### `DELETE /api/downloads/:id` — no body

Removes the download's history row — distinct from cancel, which stops an in-flight job. Only
terminal-status rows can be deleted; an active row is `409 {"error":"cancel this download before deleting it"}`.
`404` unknown, `204` on success.

### `POST /api/downloads/clear-log` — no body

Deletes every terminal (non-active) download row regardless of age — manual complement to the
automatic retention sweep. `200 {"deleted": <n>}`.

## Library

| Method | Path | Description |
|---|---|---|
| GET | `/api/library` | List/search/filter/paginate |
| GET | `/api/library/facets` | Distinct filter values (currently: years) |
| DELETE | `/api/library/:id` | Remove an item |
| PATCH | `/api/library/:id` | Edit metadata (partial merge) |
| POST | `/api/library/bulk-tags` | Overwrite tags on many items at once |
| POST | `/api/library/bulk-delete` | Delete many items at once |
| POST | `/api/library/:id/move` | Relocate to a different collection/folder |
| POST | `/api/library/:id/refresh-metadata` | Re-fetch + overwrite metadata from source |
| GET | `/api/library/:id/metadata-preview` | Read-only diff of current vs. source metadata |
| GET | `/api/library/:id/probe-metadata` | Read-only ffprobe scan of the file actually on disk |
| POST | `/api/library/:id/redownload` | Re-queue a fresh download from the source URL |
| GET | `/api/library/:id/redownload/preview-url` | Preview a *different* candidate URL before redownloading from it |
| POST | `/api/library/:id/redownload/from-url` | Redownload from a different URL, choosing which fields to overwrite |
| POST | `/api/library/:id/progress` | Record current playback position (Continue Watching) |
| POST | `/api/library/ghost` | Create a ghost (placeholder, no file) library item |
| DELETE | `/api/library/:id/file` | Delete just the file, keep the entry (becomes a ghost) |
| POST | `/api/library/scan-missing` | Convert any item whose on-record file is gone from disk into a ghost |
| POST | `/api/library/bulk-redownload` | Re-queue downloads for many items at once |
| POST | `/api/library/bulk-fetch-thumbnails` | Re-fetch thumbnails for many items at once |
| POST | `/api/library/bulk-delete-file` | Bulk version of `DELETE /:id/file` |
| POST | `/api/library/:id/trim/preview` | Generate a trimmed preview (original untouched) |
| POST | `/api/library/:id/trim/accept` | Overwrite the original with an already-generated preview |
| POST | `/api/library/:id/trim/discard` | Delete a generated preview without touching the original |
| GET | `/api/library/:id/trim/frames` | Decode every frame in a short window (frame-accurate picker) |
| POST | `/api/library/:id/thumbnail/redownload` | Re-fetch just the thumbnail |
| POST | `/api/library/:id/thumbnail/quick-grab` | Grab one random video frame as thumbnail |
| GET | `/api/library/:id/thumbnail/candidates` | Extract N candidate frames (read-only) |
| POST | `/api/library/:id/thumbnail` | Set the thumbnail from a supplied image |
| DELETE | `/api/library/:id/thumbnail` | Remove the thumbnail |
| POST | `/api/library/:id/thumbnail/gallery` | Save an image to the item's thumbnail gallery |
| GET | `/api/library/:id/thumbnail/gallery` | List the item's saved gallery images |
| POST | `/api/library/:id/thumbnail/gallery/:galleryId/apply` | Apply a saved gallery image as the active thumbnail |
| DELETE | `/api/library/:id/thumbnail/gallery/:galleryId` | Remove a saved gallery image |
| POST | `/api/library/:id/thumbnail/match` | Start an ad-hoc frame-match job for this item |
| GET | `/api/thumbnail-match/:jobId` | Poll an ad-hoc frame-match job |
| POST | `/api/library/thumbnail/match/bulk` | Bulk-enqueue items onto the durable frame-match queue |
| GET | `/api/frame-match/queue` | List the frame-match working queue |
| POST | `/api/frame-match/queue/:id/accept` | Apply a resolved queue row's found frame as the thumbnail |
| DELETE | `/api/frame-match/queue/:id` | Discard/dismiss a frame-match queue row |
| POST | `/api/library/:id/nfo` | Write/overwrite the `.nfo` sidecar |
| GET | `/api/library/:id/nfo` | Read the raw `.nfo` XML |
| DELETE | `/api/library/:id/nfo` | Remove the `.nfo` sidecar file |

### `GET /api/library` — query params (all optional)

| Param | Meaning |
|---|---|
| `q` | Full-text search (title/uploader/artist/description) |
| `collectionId` | Filter to one collection; `"none"` = uncategorized only |
| `collectionIds` | Comma-separated ids, IN-match; takes precedence over `collectionId` |
| `year` | Filter by release year |
| `tags` | Comma-separated tag names |
| `sortKey` | `downloadedAt` (default) \| `title` \| `filename` \| `year` \| `duration` \| `sequenceNumber` |
| `sortDir` | `desc` (default) \| `asc` |
| `page` | 1-based; pagination activates only when set |
| `pageSize` | Only read when `page` is set |

Response is always a wrapper, even with no pagination:

```json
{ "items": [ /* library items */ ], "total": 137 }
```

`total` is the full match count ignoring page/pageSize (for "Page X of Y" UI). Each item:

```json
{
  "id": 118, "downloadId": 42, "title": "Some Video", "filename": "Some Video.mp4",
  "path": "Music Videos/Some Video.mp4", "collectionId": 4, "collectionName": "Music Videos",
  "folder": "", "originalUrl": "https://youtube.com/watch?v=abc123",
  "uploader": "Some Channel", "duration": 214, "resolution": "1920x1080",
  "mediaType": "video", "thumbnail": "Music Videos/Some Video.jpg",
  "thumbnailSmallPath": "library/118/small/e1cdb9a8....webp",
  "thumbnailMediumPath": "library/118/medium/e1cdb9a8....webp",
  "thumbnailWidth": 1920, "thumbnailHeight": 1080,
  "description": "...", "artistId": 3, "artistName": "Some Artist", "year": 2023,
  "sequenceNumber": null, "seasonNumber": 2, "generateNfo": true, "nfoExists": true,
  "downloadedAt": "2026-07-19T10:02:00Z", "status": "completed", "blurred": false,
  "fileSizeBytes": 84213099, "tags": ["music", "live"],
  "playbackPositionSeconds": 812, "lastWatchedAt": "2026-07-20T21:15:00Z",
  "galleryCount": 3
}
```

`blurred` is true if the item's collection (or an ancestor) is private, **or** any of its tags is
marked private. `tags` is never `null` — `[]` if none. `mediaType` is `"video"`, `"audio"`, or
`null` (unset ghost items only — see Ghost items below). `status` is `"completed"` for a real
downloaded/imported item or `"ghost"` for a placeholder with no file.

`thumbnailSmallPath`/`thumbnailMediumPath` are the WebP derivatives actually rendered in the UI
(grid thumbnail, card image) — `thumbnail` is the original, full-size sidecar image on disk, never
rendered directly. `thumbnailWidth`/`thumbnailHeight` are the **original** sidecar image's pixel
dimensions (not the derivative's), probed once server-side whenever the thumbnail is written and
persisted on the row — `null` until the item has a thumbnail and it's been probed (existing items
predating this column are backfilled via `POST /api/settings/backfill-images`; see Settings below).
These two fields are deliberately omitted from library backup exports — they're a disposable
derived value, regenerated the next time the thumbnail changes.

`playbackPositionSeconds`/`lastWatchedAt` back the Browse page's "Continue Watching" row — see
`POST /api/library/:id/progress` below. `galleryCount` is the number of saved images in this item's
thumbnail gallery — see Thumbnail gallery below.

### `GET /api/library/facets` — no params

```json
{ "years": [2019, 2021, 2022, 2024] }
```

Computed across the whole library, independent of the current search/page.

### `DELETE /api/library/:id?deleteFiles=true`

`deleteFiles` (default false) best-effort removes the media file and thumbnail from disk — a
missing file is logged, not an error. `404` unknown, `204` on success.

### `PATCH /api/library/:id` — partial merge (fields omitted are left untouched)

```json
{ "title": "New Title", "artistId": 3, "year": 2023, "tags": ["music", "live"] }
```

All fields optional: `title`, `filename`, `uploader`, `description`, `duration`, `resolution`,
`artistId` (`0` explicitly clears it — distinct from omitting the field), `year`,
`sequenceNumber`, `seasonNumber`, `generateNfo`, `originalUrl`, `tags` (whole-array **replace**,
not merge, when present — creates missing tag names). Side effects:

- `filename` set → renames the media file and its thumbnail on disk (sanitized; `400` if that
  yields an empty name).
- Changing `title`/`artistId`/`year`/`sequenceNumber`/`seasonNumber` triggers a **background**
  `ffmpeg -c copy` remux that re-embeds those tags into the file's own container metadata — the
  response returns immediately, the remux failure (if any) is logged only.
- If `generateNfo` is on (or just turned on) and any NFO-relevant field changed, the `.nfo`
  sidecar is rewritten in sync, best-effort.
- `204 No Content` on success.

### `POST /api/library/bulk-tags`

```json
{ "itemIds": [1, 2, 3], "tags": ["music", "favorites"] }
```

**Overwrites** (not merges) the tag set on every listed item, creating missing tag names, and
keeps each opted-in item's `.nfo` sidecar in sync. `204`.

### `POST /api/library/bulk-delete`

```json
{ "itemIds": [1, 2, 3], "deleteFiles": true }
```

One `deleteFiles` flag for the whole batch. An already-gone id is silently skipped. Response:
`200 {"deleted": 3}`.

### `POST /api/library/:id/move`

```json
{ "collectionId": 5, "folder": "Subfolder" }
```

Relocates the media file + thumbnail on disk to the resolved target. `400` invalid
collection/folder, `500` on FS error, `204` on success.

### `POST /api/library/:id/refresh-metadata` — no body

Re-fetches yt-dlp metadata for `originalUrl` and **overwrites** `title`/`uploader`/`duration`/
`resolution`/`description` (never touches the file/thumbnail on disk; `artist`/`year`/
`sequenceNumber`/`seasonNumber` are manual-only and untouched). `400` no source URL, `502` fetch
failure. Also re-syncs the `.nfo` sidecar if enabled. Response `200` with the full updated item.

### `GET /api/library/:id/metadata-preview` — no body

Same yt-dlp re-fetch as refresh-metadata, but **read-only — never writes to the DB**. Powers the
"Compare Metadata" dialog. `400` no source URL, `502` fetch failure.

```json
{
  "title": "Some Video (Remastered)", "uploader": "Some Channel", "duration": 215,
  "description": "...", "thumbnail": "https://...jpg", "resolution": "1920x1080"
}
```

### `GET /api/library/:id/probe-metadata` — no body, read-only

Runs `ffprobe` directly against the **file on disk** (not a network fetch) and returns what it
finds — resolution/duration/frame rate, `null` where not applicable (e.g. no duration for a still
image). Answers "does what's saved in the DB match the actual file?" (catches drift from an
out-of-band file replacement, or a Trim side effect), as opposed to `metadata-preview` above, which
answers "did the upstream source change?" `400` item has no media file (ghost item), `404` unknown
item.

```json
{ "resolution": "1920x1080", "durationSeconds": 214, "frameRate": 29.97 }
```

### `POST /api/library/:id/redownload` — no body

Re-queues a download from `originalUrl`, reusing the exact original type/quality/filename/
audioFormat if the originating download row still exists, else falling back to app defaults.
`400` no source URL. Response `201 {"id": <newDownloadId>}`.

### Redownload from a different URL

- **`GET /api/library/:id/redownload/preview-url?url=https://...`** — read-only, same shape as
  `metadata-preview` but against an arbitrary URL instead of the item's own `originalUrl`. `400`
  invalid URL, `422` fetch failure.
  ```json
  {
    "title": "Some Video (Alt Upload)", "uploader": "Another Channel", "duration": 220,
    "description": "...", "thumbnail": "https://...jpg", "resolution": "1920x1080",
    "duplicate": { "libraryItemId": 90, "title": "Other Item", "thumbnail": "...", "downloadedAt": "2026-07-19T10:00:00Z" }
  }
  ```
  `duplicate` is set only when the URL matches a *different* library item, else `null`.
- **`POST /api/library/:id/redownload/from-url`** —
  ```json
  { "url": "https://youtube.com/watch?v=xyz789", "overwriteFields": ["resolution", "duration"] }
  ```
  `url` required. `overwriteFields` is a subset of `title`/`uploader`/`description`/`thumbnail`/
  `resolution`/`duration` — `400` on anything outside that set. `originalUrl` (and its video ID)
  always switch to the new URL regardless of `overwriteFields`; only the *content* of the listed
  fields is overwritten. Reuses the original download row's type/quality/audioFormat if it still
  exists. Response `201 {"id": <newDownloadId>}`.

### `POST /api/library/:id/progress`

```json
{ "positionSeconds": 842 }
```

`positionSeconds` required, `>= 0`. Records live playback position for the Browse page's "Continue
Watching" row (see [Browse](FEATURES.md#browse)) — called repeatedly (throttled client-side) during
video playback, hence a narrow single-field endpoint rather than the general `PATCH /:id`.
Video-only in practice; music playback never calls this. `404` unknown item, `204` on success.

### Ghost items

A ghost item is a library row with metadata but **no downloaded file** — `filename`/`path` are
`""` and `status="ghost"`. Used as a placeholder you fill in later (Redownload relabels itself
"Download now" for these), and it's also the state a real item falls back into when its file is
deleted (`DELETE /:id/file`) or found missing on disk (`scan-missing`).

- **`POST /api/library/ghost`** —
  ```json
  {
    "title": "Some Video", "mediaType": "video", "originalUrl": "https://youtube.com/watch?v=abc123",
    "collectionId": 4, "artistId": 3, "year": 2023, "seasonNumber": 2, "sequenceNumber": null,
    "generateNfo": false, "tags": ["music", "live"], "fetchThumbnail": true
  }
  ```
  `title` and `mediaType` (`video`|`audio`) required; everything else optional. `mediaType` is
  picked manually since there's no file/download row to infer it from — it only selects which
  placeholder icon shows until the item is downloaded. If `fetchThumbnail` and `originalUrl` are
  both set, a best-effort thumbnail fetch runs before responding (failure is logged, not fatal).
  Response `201` with the full library item (`galleryCount` always `0` on a fresh item).
- **`DELETE /api/library/:id/file?deleteThumbnail=true`** — removes just the media file (best-effort
  on disk) and flips the item to `status="ghost"`; all other metadata (tags, collection, artist,
  etc.) is untouched. `deleteThumbnail` (default false) also removes the thumbnail. Distinct from
  the already-documented `DELETE /api/library/:id?deleteFiles=true`: that one deletes the DB row
  entirely and is permanent — this keeps the row so it can be redownloaded later. `400` item is
  already a ghost, `404` unknown id, `204` on success.
- **`POST /api/library/scan-missing`** — no body. Checks every non-ghost item's on-record file
  against disk; anything gone is converted to a ghost the same way. On-demand only (Settings →
  Library → "Scan for Missing Files"), never scheduled.
  ```json
  { "scanned": 137, "missing": [ { "id": 118, "title": "Some Video" } ] }
  ```
- **`POST /api/library/bulk-redownload`** — `{ "itemIds": [1, 2, 3] }`. Redownloads each item from
  its own `originalUrl` (same resolution/duration-only overwrite as single-item Redownload). Items
  with no URL, or whose enqueue fails, are silently skipped. `200 {"queued": 2, "skipped": 1}`.
- **`POST /api/library/bulk-fetch-thumbnails`** — `{ "itemIds": [1, 2, 3] }`. Re-fetches each item's
  thumbnail from its `originalUrl` — works identically for ghost or real items, since it only
  writes the `ImagesRoot`-relative WebP derivatives, never the `MediaRoot`-relative sidecar. Items
  with no source URL, or a failed fetch, are skipped. `200 {"fetched": 2, "skipped": 1}`.
- **`POST /api/library/bulk-delete-file`** — `{ "itemIds": [1, 2, 3], "deleteThumbnail": true }`. One
  `deleteThumbnail` flag for the whole batch (same semantics as the single-item version above). An
  id already gone, or already a ghost, is silently skipped. `200 {"deleted": 2}`.

### Trim

Cuts a precise portion off the start and/or end of a video/audio file, previewed before committing.

- **`POST /api/library/:id/trim/preview`** —
  ```json
  { "trimStartSeconds": 5.2, "trimEndSeconds": 118.75 }
  ```
  At least one of the two required; either may be `null` ("don't trim that end"). Generates a
  trimmed copy into a scratch dir under `mediaRoot` — **the original file is untouched**. `400`
  both fields omitted or item has no media file, `404` unknown item, `422` ffmpeg failure. Response
  `200`:
  ```json
  { "previewPath": ".trim-tmp/.trim-preview-abc123.mp4", "durationSeconds": 113, "fileSizeBytes": 48213099 }
  ```
  `previewPath` is `MediaRoot`-relative, playable via the existing `/media-files/*path` route.
- **`POST /api/library/:id/trim/accept`** — `{ "previewPath": ".trim-tmp/.trim-preview-abc123.mp4" }`.
  The server re-validates that the path resolves under `mediaRoot`, sits directly inside the shared
  trim scratch dir, and matches the `.trim-preview-` naming convention (`400` otherwise — defense
  against accepting an unrelated file). Overwrites the item's real media file with the preview,
  re-probes duration/size, updates the DB. Response `200` with the full updated library item.
- **`POST /api/library/:id/trim/discard`** — same body/validation as accept, just deletes the
  preview file without touching the original. `204`.
- **`GET /api/library/:id/trim/frames?start=5.0&end=8.0`** — read-only, nothing persisted. Decodes
  every frame in `[start, end)` for frame-accurate seeking the browser's own scrubber can't
  guarantee. `400` invalid range, `422` extraction failure.
  ```json
  { "frames": [ { "timestampSeconds": 5.04, "imageBase64": "/9j/4AAQ..." } ] }
  ```

### Thumbnails

- **`POST /api/library/:id/thumbnail/redownload`** — no body. Re-fetches the thumbnail from
  `originalUrl`, overwriting the current one. `400` no source URL, `502` fetch failure.
- **`POST /api/library/:id/thumbnail/quick-grab`** — no body. Extracts one video frame at a random
  timestamp within the configured pick range (see `thumbnailFrameRangeLow`/`High` below; default
  5%-100% of duration, skipping the likely-blank intro) and sets it immediately. `502` if extraction
  fails.
- **`GET /api/library/:id/thumbnail/candidates`** — no body, read-only. Extracts N frames (N = the
  `thumbnailFrameCount` setting: 2/4/6/8/12/24), spread across the same configured pick range, as
  base64 JPEGs. A per-candidate failure is skipped, not fatal; `502` only if zero candidates could
  be extracted.
  ```json
  { "candidates": [ { "timestampSeconds": 34.2, "imageBase64": "/9j/4AAQ..." } ] }
  ```
- **`POST /api/library/:id/thumbnail`** — `{ "imageBase64": "/9j/4AAQ..." }`. Writes the given
  bytes as the thumbnail — finalize step for "choose from video." `400` invalid base64. All three
  thumbnail endpoints respond `200` with the full updated library item.
- **`DELETE /api/library/:id/thumbnail`** — removes the thumbnail (all tiers). `404` unknown item,
  `204` on success.

### Thumbnail gallery

A per-item collection of saved candidate thumbnail images — separate from the one *active*
thumbnail — so a few good options can be stashed and switched between later without
re-extracting/re-fetching. Cascade-deleted with the library item.

- **`POST /api/library/:id/thumbnail/gallery`** — body optional:
  ```json
  { "imageBase64": "/9j/4AAQ..." }
  ```
  Empty/omitted body saves a copy of the item's *current* thumbnail as-is; a non-empty
  `imageBase64` saves those exact bytes instead (e.g. a specific frame from "Choose from Video," or
  a Frame Matching result). `400` item has neither a current thumbnail nor a supplied image.
  Response `201`:
  ```json
  { "id": 12, "imagePath": "thumbnail-gallery/118/6c1f...-4a2e.jpg", "width": 1920, "height": 1080, "createdAt": "2026-07-19T10:00:00Z" }
  ```
- **`GET /api/library/:id/thumbnail/gallery`** — no params.
  ```json
  { "images": [ { "id": 12, "imagePath": "thumbnail-gallery/118/6c1f...-4a2e.jpg", "width": 1920, "height": 1080, "createdAt": "..." } ] }
  ```
  `imagePath` is `ImagesRoot`-relative, served under `/local-images/*` — distinct from `thumbnail`,
  which is `MediaRoot`-relative.
- **`POST /api/library/:id/thumbnail/gallery/:galleryId/apply`** — no body. Makes a saved gallery
  image the item's active thumbnail (same finish as `POST .../thumbnail`: regenerates derivatives,
  clears any stale AI-enhancement backup). `400` item has no media file, or `galleryId` belongs to a
  different item; `404` unknown gallery id/item. `200` with the full updated library item.
- **`DELETE /api/library/:id/thumbnail/gallery/:galleryId`** — removes the saved image; doesn't
  touch the active thumbnail. `400` belongs to a different item, `404` unknown id, `204` on
  success.

### Frame matching

Scans a video for the frame that most closely matches a reference image (either the item's
source-URL thumbnail or its current thumbnail file) — useful when a saved thumbnail is a
degraded/cropped/re-encoded copy and you want to relocate it back to the actual clean frame it came
from. Uses perceptual-hash comparison (a coarse sweep, then a fine windowed pass on the best
candidates), **not** duplicate-video detection. Two independent flows: a single-item ad-hoc job
(poll-based, in-memory — lost on restart), and a durable bulk queue reviewed on the dedicated
"Frame Matching" page.

- **`POST /api/library/:id/thumbnail/match`** — `{ "mode": "url" }` (`"url"` re-fetches the source
  URL's thumbnail fresh to compare against; `"current"` compares against whatever thumbnail file
  the item has right now, including an enhanced one). `400` no media file, `404` unknown item,
  `409` item already has a pending/awaiting-review row in the bulk queue, `502` reference-image
  resolution failed. Response `200 {"jobId": "b3f1..."}` — matching runs in the background.
- **`GET /api/thumbnail-match/:jobId`** —
  ```json
  {
    "state": "done", "timestampSeconds": 842.5, "score": 91.4,
    "imageBase64": "/9j/4AAQ...", "referenceImageBase64": "/9j/4AAQ..."
  }
  ```
  `state` is `"running"`, `"done"`, or `"error"` (then `{"state":"error","error":"..."}`). `score`
  is 0–100, higher = closer match — never hidden even when low, since a correct match can still
  score in the 70s–80s. `404` unknown job id (never existed, or the process restarted).
- **`POST /api/library/thumbnail/match/bulk`** — `{ "itemIds": [101, 102, 103], "mode": "url" }`.
  Enqueues each eligible item onto the durable queue, worked one at a time by a background worker.
  An item is skipped (not an error) if it's a ghost, or ineligible for the mode (no `originalUrl`
  for `"url"`, no current thumbnail for `"current"`); already-queued is counted separately.
  Response `202 {"queued": 2, "skipped": 1, "alreadyQueued": 0}`.
- **`GET /api/frame-match/queue`** — no params. Every row currently queued/running/done/error,
  oldest first:
  ```json
  {
    "id": 7, "libraryItemId": 118, "itemTitle": "Some Video", "mode": "url", "state": "done",
    "timestampSeconds": 842.5, "score": 91.4,
    "foundFramePath": "frame-match/7/found.jpg", "referenceImagePath": "frame-match/7/reference.jpg",
    "error": null
  }
  ```
  `foundFramePath`/`referenceImagePath` (`ImagesRoot`-relative) populate once `state="done"` — a
  snapshot from match-completion time, so the review screen always matches the recorded score even
  if the source or live thumbnail changes before you review it.
- **`POST /api/frame-match/queue/:id/accept`** — no body. Writes the row's found frame as the
  item's active thumbnail (same commit path as `SetLibraryThumbnail`/gallery-apply), then deletes
  the queue row and its snapshot images — a working queue, not a history. `409` row isn't
  `state="done"`, `400` item has no media file, `200` with the full updated library item.
- **`DELETE /api/frame-match/queue/:id`** — no body. Removes the row and its snapshot files without
  touching the item's thumbnail; also cancels a still-running row. `404` unknown id, `204`.

### NFO sidecars

- **`POST /api/library/:id/nfo`** — no body. `400 {"error":"Generate NFO is not enabled for this item"}`
  if the `generateNfo` toggle is off, else writes/overwrites the sidecar. `204`.
- **`GET /api/library/:id/nfo`** — `200 {"content": "<movie>...</movie>"}`. `404` if none generated
  yet.
- **`DELETE /api/library/:id/nfo`** — removes the sidecar file only, does **not** touch the
  `generateNfo` toggle (so it reappears on the next relevant edit if still on). Idempotent, `204`.

## Collections

| Method | Path | Description |
|---|---|---|
| GET | `/api/collections` | List all collections |
| POST | `/api/collections` | Create a collection |
| PATCH | `/api/collections/:id` | Update a collection |
| DELETE | `/api/collections/:id` | Delete a collection |
| POST | `/api/collections/bulk-delete` | Delete many at once |
| GET | `/api/collections/:id/cover-candidates` | List image files already in this collection's folder |
| POST | `/api/collections/:id/cover` | Set the collection's cover image |
| DELETE | `/api/collections/:id/cover` | Remove the collection's cover image |

### `GET /api/collections`

```json
{
  "id": 7, "name": "Anime", "parentId": 2, "rootPath": "Anime", "path": "Shows/Anime",
  "defaultQuality": "1080p", "defaultDownloadType": "video", "isPrivate": false,
  "seasonNumber": 2, "artistId": null, "itemCount": 12,
  "effectiveIsPrivate": false, "totalItemCount": 40,
  "coverImagePath": null, "coverImageSmallPath": null, "coverImageMediumPath": null,
  "latestItemThumbnailPath": "Anime/Season 1/Episode 3.jpg",
  "jellyfinLibraryId": "3c8f6b1a-...", "createdAt": "...", "updatedAt": "..."
}
```

`isPrivate`/`itemCount` are this collection's own flag and direct item count; `effectiveIsPrivate`
(this OR any ancestor private) and `totalItemCount` (own + all descendants) are the
inheritance-aware versions used by things like the Library toolbar's reveal-all control.
`coverImage*Path` are set only once a cover has been explicitly assigned (see below); until then,
folder/Browse tiles fall back to `latestItemThumbnailPath` — the most-recently-downloaded item's
thumbnail anywhere in the collection's subtree.

### Cover image

- **`GET /api/collections/:id/cover-candidates`** — read-only. Recursively scans the collection's
  own resolved on-disk folder for image files already present among its downloaded content —
  nothing is copied yet. `404` unknown collection.
  ```json
  { "candidates": [ { "relPath": "Anime/Season 1/poster.jpg" } ] }
  ```
  `relPath` is `MediaRoot`-relative, same convention as a library item's `thumbnail`.
- **`POST /api/collections/:id/cover`** — exactly one of two sources:
  ```json
  { "sourceRelPath": "Anime/Season 1/poster.jpg", "imageBase64": null, "filename": null }
  ```
  or
  ```json
  { "sourceRelPath": null, "imageBase64": "/9j/4AAQ...", "filename": "cover.jpg" }
  ```
  `400` neither source set, `404` unknown collection. Generates three WebP derivatives (small
  320px / medium 800px / a capped 1920px "original" — never the untouched source bytes), deletes
  the old cover's files (best-effort), persists the three new relative paths. Response `200`:
  ```json
  {
    "coverImagePath": "collections/7/original-<uuid>.webp",
    "coverImageSmallPath": "collections/7/small-<uuid>.webp",
    "coverImageMediumPath": "collections/7/medium-<uuid>.webp"
  }
  ```
- **`DELETE /api/collections/:id/cover`** — deletes all three tier files (best-effort) and clears
  all three columns to `null`, reverting the collection to its automatic `latestItemThumbnailPath`
  fallback. `404` unknown collection, `204` on success.

### `POST /api/collections`

```json
{
  "name": "Anime", "parentId": 2, "rootPath": "Anime",
  "defaultQuality": "1080p", "defaultDownloadType": "video", "isPrivate": false,
  "jellyfinLibraryId": null, "seasonNumber": null, "artistId": null
}
```

`name` and `rootPath` are required; `defaultQuality`/`defaultDownloadType` default to
`"best"`/`"video"` if empty. `rootPath` is validated to resolve under the media root (rejects
traversal). `400` unknown parent or invalid root path, `409` duplicate name (parent-scoped
uniqueness). Response `201 {"id": 7}`.

- `seasonNumber` — new downloads placed directly into this collection default their own Season #
  to this value (not inherited by sub-collections).
- `artistId` — new downloads placed into this collection, or any sub-collection that doesn't set
  its own `artistId`, default their own Artist to this value (walks up the ancestor chain).

### `PATCH /api/collections/:id`

Same shape as create, minus `parentId` (fixed at creation time). `404` unknown id, `409` duplicate
name, `204` on success.

### `DELETE /api/collections/:id`

`404` unknown, `409 {"error":"collection has sub-collections — move or delete them first"}` if it
has children, `204` on success. Never deletes the files inside it — items just lose their
collection association.

### `POST /api/collections/bulk-delete`

```json
{ "ids": [5, 6, 7] }
```

Deletes deepest-first (so a selected parent+child pair in the same batch succeeds regardless of
order). A collection left with a child that *wasn't* in the batch is skipped, not failed:

```json
{ "deleted": 2, "skipped": [5] }
```

## Tags

| Method | Path | Description |
|---|---|---|
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create a tag |
| PATCH | `/api/tags/:id` | Rename/update a tag |
| DELETE | `/api/tags/:id` | Delete a tag |
| POST | `/api/tags/bulk-delete` | Delete many at once |

`Tag`: `{id, name, isPrivate, createdAt, usageCount}`.

- **POST/PATCH** body: `{ "name": "...", "isPrivate": false }`. `name` required. `isPrivate` marks
  every item carrying this tag as blurred, same effect as a private collection. `409` if the name
  is already in use.
- **DELETE** — `204`, `404` unknown. `bulk-delete` — `{ "ids": [...] }` → `200 {"deleted": n}`;
  never fails for "in use" since the join table cascades on delete.

## Compare list

A scratch list of library items (video/audio files) queued up to **play back simultaneously in a
synced grid** — not a metadata/thumbnail comparison tool (that's Compare Metadata, under Library
above). Backed by a single unordered set, one user, no per-item metadata beyond insertion order.

| Method | Path | Description |
|---|---|---|
| GET | `/api/compare-list` | List every item currently on the compare list |
| POST | `/api/compare-list` | Add one or more items |
| DELETE | `/api/compare-list/:id` | Remove one item |
| DELETE | `/api/compare-list` | Clear the whole list |

### `GET /api/compare-list` — no params

A **bare array** (not the `{items, total}` wrapper `GET /api/library` uses), oldest-added-first, of
full library item objects — same shape and privacy-blur resolution as `GET /api/library`'s items.

### `POST /api/compare-list`

```json
{ "itemIds": [118, 119, 120] }
```

`itemIds` required, at least one. Re-adding an id already on the list is a silent no-op; an
unknown id is silently skipped rather than failing the whole batch. `204`.

### `DELETE /api/compare-list/:id` — no body

`:id` is the library item's own id. `404` not on the list, `204` on success.

### `DELETE /api/compare-list` — no body

Empties the list unconditionally. `204`.

Note: the frontend caps playback selection at 6 items and filters out ghost items (no file to
play) — the API itself enforces neither limit, so the list can hold more than 6 items even though
only 6 can be selected for simultaneous playback.

## Artists

Identical pattern to Tags, minus `isPrivate`, plus an optional image gallery.

| Method | Path | Description |
|---|---|---|
| GET | `/api/artists` | List all artists |
| POST | `/api/artists` | Create an artist |
| PATCH | `/api/artists/:id` | Rename an artist |
| DELETE | `/api/artists/:id` | Delete an artist |
| POST | `/api/artists/bulk-delete` | Delete many at once |
| GET | `/api/artists/:id/image-candidates` | Suggest images from this artist's own library items |
| GET | `/api/artists/:id/images` | List the artist's image gallery |
| POST | `/api/artists/:id/images` | Add an image to the gallery |
| DELETE | `/api/artists/:id/images/:imageId` | Remove a gallery image |
| POST | `/api/artists/:id/images/:imageId/select` | Set a gallery image as the display picture |
| DELETE | `/api/artists/:id/selected-image` | Clear the display picture (gallery image itself untouched) |

`Artist`: `{id, name, birthday, selectedImagePath, createdAt, usageCount}`. Body: `{ "name": "..." }`.
`409` on name conflict. Deleting an artist referenced elsewhere doesn't fail — the foreign key is
`ON DELETE SET NULL`. `birthday` is a nullable date-only string (`"1990-01-01"`); `selectedImagePath`
is a nullable relative path pointing at one of the artist's own gallery images (see below).

### Image gallery

- **`GET /api/artists/:id/image-candidates`** — read-only. Distinct thumbnail paths of every
  library item currently tagged with this artist — nothing copied yet.
  ```json
  { "candidates": [ { "relPath": "Music Videos/Some Video.jpg" } ] }
  ```
- **`GET /api/artists/:id/images`** —
  ```json
  [ { "id": 5, "relativePath": "artists/3/image-<uuid>.webp", "createdAt": "2026-07-19T10:00:00Z" } ]
  ```
- **`POST /api/artists/:id/images`** — same dual-source body as collection covers:
  ```json
  { "sourceRelPath": "Music Videos/Some Video.jpg", "imageBase64": null, "filename": null }
  ```
  `404` unknown artist, `400` neither source set. Generates one WebP derivative (single tier, max
  width 400px — unlike collection covers' three-tier split, since artist images are only ever shown
  small). Response `201 {"id": 5, "relativePath": "artists/3/image-<uuid>.webp", "createdAt": "..."}`.
- **`DELETE /api/artists/:id/images/:imageId`** — `404` unknown artist or image. Deletes the file
  (best-effort) and row; if this was the artist's currently-selected image, the selection is
  cleared automatically rather than left dangling. `204`.
- **`POST /api/artists/:id/images/:imageId/select`** — no body. `404` unknown image, `400` the
  image belongs to a different artist. Sets `selectedImagePath` to that image's path. `204`.
- **`DELETE /api/artists/:id/selected-image`** — no body. Clears the selection pointer only — the
  gallery image itself stays, still selectable again later. `404` unknown artist, `204`.

## Settings

| Method | Path |
|---|---|
| GET | `/api/settings` |
| PATCH | `/api/settings` |

### `GET /api/settings` — every field always present

```json
{
  "downloadDirectory": "/media", "maxConcurrentDownloads": 3, "downloadTimeoutMinutes": 0,
  "defaultQuality": "best", "defaultDownloadType": "video", "importIgnoredFolders": [".stfolder"],
  "historyAnonymizeUrls": false, "historyRetentionDays": 0, "downloadLogRetentionDays": 0,
  "libraryView": "grid", "librarySortKey": "downloadedAt", "librarySortDir": "desc",
  "libraryMode": "manage", "libraryPaginationEnabled": false, "libraryPageSize": 48,
  "thumbnailFrameCount": 4, "thumbnailFrameRangeLow": 5, "thumbnailFrameRangeHigh": 100,
  "privacyBlurStrength": "default", "skipDownloadPreview": false,
  "jellyfinEnabled": false, "jellyfinUrl": "", "jellyfinApiKey": "", "jellyfinRefreshMode": "none",
  "libraryAutoplay": true, "imageConvertFormat": "jpg"
}
```

`downloadDirectory` and `maxConcurrentDownloads` reflect live config/worker-pool state, not just
the last saved DB value. `jellyfinApiKey` is returned in plaintext, not masked. `imageConvertFormat`
(`"original"|"jpg"|"png"|"webp"`, default `"jpg"`) is the format every `downloadType=image` download
gets re-encoded to — matches the existing convention that video/audio thumbnails always normalize to
JPEG. `thumbnailFrameRangeLow`/`thumbnailFrameRangeHigh` (percent 0-100, default 5/100) bound which
portion of a video's duration "Choose from Video"/Quick Grab pick candidate frames from — see the
Library thumbnail endpoints above.

### `PATCH /api/settings` — every field optional, only provided ones are persisted

```json
{ "maxConcurrentDownloads": 5, "libraryView": "folders" }
```

Same field set as the `GET` response. Notes:

- `librarySortKey`/`librarySortDir` are stored together as one row — patching just one merges with
  the other's current value.
- `maxConcurrentDownloads` **immediately resizes the live worker pool**, no restart needed.
- `downloadDirectory` (`MEDIA_ROOT`) is **not** patchable here — env-config only.

`204 No Content` on success.

### Image derivative backfill

| Method | Path | Description |
|---|---|---|
| POST | `/api/settings/backfill-images` | Start the backfill (no-op if already running) |
| GET | `/api/settings/backfill-images` | Poll current/last run's progress |

Regenerates missing WebP thumbnail/artist-image/collection-cover derivatives for anything that
predates them, and separately backfills `thumbnailWidth`/`thumbnailHeight` (see Library above) for
older items that already have derivatives but never had their dimensions probed. Safe to re-run —
already-migrated items/rows are skipped. Both endpoints return the same status snapshot:

```json
{
  "running": true, "startedAt": "2026-08-22T10:00:00Z", "finishedAt": null,
  "libraryProcessed": 118, "libraryFailed": 2,
  "artistProcessed": 0, "artistFailed": 0,
  "coverProcessed": 0, "coverFailed": 0
}
```

`POST` kicks off the sweep asynchronously and returns the status immediately; calling it again
while already running is a harmless no-op. `finishedAt` stays `null` while `running: true`.

## Backup

| Method | Path | Description |
|---|---|---|
| POST | `/api/backup/export/settings` | Export all settings to a portable bundle |
| POST | `/api/backup/export/library` | Export collections/tags/artists/library refs |
| POST | `/api/backup/import/settings` | Import a settings bundle (also accepts a full-kind file) |
| POST | `/api/backup/preview/library` | Preview a library-bundle import (dry run) |
| POST | `/api/backup/import/library` | Import a library bundle (also accepts a full-kind file) |
| POST | `/api/backup/preview/full` | Preview an ad-hoc uploaded full backup (settings + library) |
| POST | `/api/backup/import/full` | Import an ad-hoc uploaded full backup |
| GET | `/api/backup/history` | List every recorded scheduled/manual backup run |
| POST | `/api/backup/run` | Run a full backup now ("Run Backup Now") |
| GET | `/api/backup/history/:id/download` | Download a backup-history file |
| GET | `/api/backup/history/:id/preview` | Read-only content summary of a history-resident backup |
| POST | `/api/backup/history/:id/restore` | Restore a full backup already sitting in history |
| DELETE | `/api/backup/history/:id` | Delete a backup-history row (+ best-effort unlink its file) |

Three envelope `kind`s exist: `"settings"`, `"library"`, and `"full"` (settings + library
combined — the shape "Run Backup Now" and the scheduler produce). The Settings and Library import
endpoints both accept **either their own kind or `"full"`**, extracting just their own half — so a
full backup file can be fed into any of the three import entry points, not just the dedicated Full
Backup one. Every export/import shares an envelope wrapper:

```json
{
  "packrat": true, "version": 1, "kind": "settings",
  "exportedAt": "2026-07-19T10:00:00Z", "encrypted": false,
  "salt": "", "data": "base64..."
}
```

`data` is base64 of the plaintext JSON payload, or of (nonce + ciphertext) if `encrypted`.

### `POST /api/backup/export/settings` / `POST /api/backup/export/library`

Body: `{ "password": "optional passphrase" }` — omit/empty for an unencrypted export. Response
`200` is an envelope. The settings bundle is a plain `map[string]string` of every raw settings
row. The library bundle:

```json
{
  "collections": [
    {
      "path": ["Shows", "Anime"], "name": "Anime",
      "defaultQuality": "1080p", "defaultDownloadType": "video", "isPrivate": false,
      "jellyfinLibrary": "3c8f6b1a-...", "seasonNumber": 2, "artistName": "Some Artist"
    }
  ],
  "tags": [ { "name": "music", "isPrivate": false } ],
  "artists": ["Some Artist"],
  "libraryItems": [
    {
      "title": "Some Video", "originalUrl": "https://youtube.com/watch?v=abc123",
      "collectionPath": ["Shows", "Anime"], "folder": "", "filename": "Some Video.mp4",
      "downloadType": "video", "quality": "1080p", "artistName": "Some Artist",
      "year": 2023, "seasonNumber": 2, "tags": ["music"]
    }
  ]
}
```

Collections/artists/tags are referenced by path/name, never numeric ID, so a bundle is portable
across installs. **Only library items with a saved `originalUrl` are included — no media bytes are
ever shipped**; re-import re-queues downloads from those URLs. `downloadType`/`quality`/
`audioFormat` are omitted if the originating download row is already gone at export time.

### `POST /api/backup/preview/library` / `POST /api/backup/import/settings` / `POST /api/backup/import/library`

```json
{ "data": "{\"packrat\":true,\"version\":1,...}", "password": null, "mode": "download" }
```

`data` is the raw text of a previously-exported (or full-kind) file. Parses the envelope, checks
`kind` is the endpoint's own or `"full"` (`400` if neither), decrypts if needed (`400` on wrong
password). `mode` (import only, ignored by preview) is `"download"` (default) or `"ghostOnly"`.
Settings import overwrites every key present in the bundle (never deletes keys absent from it) and
live-resizes the worker pool if `maxConcurrentDownloads` was included:

```json
{ "applied": 23 }
```

Library **preview** is read-only — diffs the bundle against the current library without writing
anything, so the frontend can show new-vs-already-in-library counts before committing:

```json
{
  "collections": [ { "path": ["Shows", "Anime"], "name": "Anime", "isNew": false } ],
  "collectionsNew": 1, "tags": ["music"], "tagsNew": 0,
  "artists": ["Some Artist"], "artistsNew": 0,
  "items": [ { "title": "Some Video", "originalUrl": "...", "isNew": true, "isGhost": false } ],
  "alreadyInLibrary": 4
}
```

Library **import** merges: matches collections by path and tags/artists by name, creates only
what's missing, never deletes anything (a name collision on one entry is skipped, not fatal).
`mode: "ghostOnly"` recreates every item as a ghost placeholder (see Ghost items, above) instead
of queuing anything; otherwise every item with a saved URL is queued for redownload (a bare item
with no URL is always created as a ghost regardless of mode — there's nothing to download from). A
missing `downloadType` is inferred from the filename extension before falling back to the app
default. Tags on redownloaded items aren't automatically reapplied — retag once the redownload
finishes.

```json
{ "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 12, "ghostsCreated": 1 }
```

Common errors for all three: `400` for a non-Packrat file, wrong `kind`, or a wrong password;
`500` otherwise.

### Full backup

`POST /api/backup/preview/full` / `POST /api/backup/import/full` take the same
`{data, password, mode}` body as above, but require exactly `kind: "full"` (they don't accept a
narrower settings-only or library-only file — use the Settings/Library endpoints for those).
Preview `200`:

```json
{
  "settingsCount": 23,
  "library": { "collections": [...], "collectionsNew": 1, "tags": [...], "tagsNew": 0, "artists": [...], "artistsNew": 0, "items": [...], "alreadyInLibrary": 4 }
}
```

`library` is the identical `backup.LibraryBundlePreview` shape `preview/library` returns above.
Import `200`:

```json
{
  "settingsApplied": 23,
  "library": { "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 11, "ghostsCreated": 1 }
}
```

### Backup history

Packrat can back itself up automatically: `PATCH /api/settings` with `autoBackupIntervalHours` set
to `6`/`12`/`24`/`72`/`168` (`0` disables it) turns on a background scheduler that writes a
full settings+library snapshot to disk once the interval has elapsed since the last successful
run — checked on the same shared hourly sweep as history/log retention (see
[architecture.md](architecture.md)), so it's coarse-grained but never needs a dedicated cron.
Automatic/manual disk-resident backups are **always unencrypted** (there's nowhere to prompt for a
password unattended) — use the plain Export cards above for a password-protected file.

- **`GET /api/backup/history`** — every recorded run, most recent first:
  ```json
  [
    {
      "id": 41, "createdAt": "2026-08-22T03:00:00Z", "triggerType": "scheduled",
      "status": "success", "fileName": "backup-20260822-030000-4a1f.json",
      "fileSizeBytes": 184320, "libraryItemsCount": 320, "collectionsCount": 14,
      "tagsCount": 9, "artistsCount": 6, "errorMessage": null
    },
    {
      "id": 40, "createdAt": "2026-08-21T14:12:03Z", "triggerType": "manual",
      "status": "failed", "fileName": null, "fileSizeBytes": null,
      "libraryItemsCount": null, "collectionsCount": null, "tagsCount": null,
      "artistsCount": null, "errorMessage": "writing backup file: disk full"
    }
  ]
  ```
  `triggerType` is `"manual"` (Run Backup Now) or `"scheduled"`. `status` is `"success"`/`"failed"`
  — a failed run is still recorded (with every count/`fileName` field `null`), so this table
  doubles as a health check for the scheduler.
- **`POST /api/backup/run`** — no body. Runs one immediately. `201` with a single history entry
  (same shape as above) even when `status: "failed"` — only a `500` if the history row itself
  couldn't be persisted.
- **`GET /api/backup/history/:id/download`** — no body, streams the file as an attachment. `404`
  unknown row, no file recorded (a failed run), or the file is missing on disk.
- **`GET /api/backup/history/:id/preview`** — read-only, no password (always unencrypted). Same
  not-found cases as download. Response:
  ```json
  {
    "settingsCount": 23,
    "collections": [ { "path": ["Shows", "Anime"], "name": "Anime" } ],
    "tags": ["music", "favorites"], "artists": ["Some Artist"],
    "items": [ { "title": "Some Video", "originalUrl": "...", "collectionPath": ["Shows", "Anime"], "artistName": "Some Artist", "tags": ["music"], "isGhost": false } ]
  }
  ```
- **`POST /api/backup/history/:id/restore`** — body `{ "mode": "download" }` (optional, same
  `download`/`ghostOnly` choice as a plain import). Same not-found cases. `200`:
  ```json
  { "settingsApplied": 23, "library": { "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 11, "ghostsCreated": 1 } }
  ```
- **`DELETE /api/backup/history/:id`** — `404` unknown, `204` on success. Also best-effort deletes
  the file on disk.
- Old backups are pruned automatically after every run, keeping the most recent N (setting
  `backupRetentionCount`, default 14, `0` = unlimited).

## Import

For files placed under the media root from outside the app (copied in manually, or produced by
another tool) — brings them into the Library without a real download.

| Method | Path | Description |
|---|---|---|
| GET | `/api/import/scan` | List untracked files under `MEDIA_ROOT` |
| POST | `/api/import` | Import one scanned file |

### `GET /api/import/scan` — no params, read-only, safe to re-run

Filters out anything under a configured ignored folder.

```json
[
  {
    "path": "Music/Some Song.mp3", "filename": "Some Song.mp3", "sizeBytes": 8421309,
    "durationSeconds": 214, "resolution": null,
    "collectionPath": "Music", "newCollectionPath": ""
  }
]
```

`newCollectionPath` is the suffix of `collectionPath` that doesn't exist as a collection yet
(`""` if all segments already exist).

### `POST /api/import`

```json
{ "path": "Music/Some Song.mp3", "originalUrl": "https://youtube.com/watch?v=abc" }
```

`path` required, `originalUrl` optional. Creates any missing collections matching the on-disk
folder chain, probes duration/resolution, resolves a thumbnail (a same-basename sidecar image on
disk first, else — only if `originalUrl` given — a best-effort yt-dlp thumbnail-only fetch), and
creates the library row directly as `status="completed"`. **Never triggers a real download.**
`400` invalid/traversal path or file not found, `409` already imported. Response `201` with the
new library item.

## History

A permanent record of every download attempt, independent of the live Downloads queue.

| Method | Path | Description |
|---|---|---|
| GET | `/api/history` | List all history entries |
| POST | `/api/history/:id/retry` | Re-queue from a history entry |
| DELETE | `/api/history/:id` | Delete one entry |
| POST | `/api/history/clear` | Delete every entry now |

`GET /api/history` — no params:

```json
{
  "id": 9, "downloadId": 42, "url": "https://...", "title": "Some Video",
  "thumbnail": "...", "status": "completed", "errorMessage": null,
  "createdAt": "2026-07-19T10:00:00Z"
}
```

`status` includes `duplicate` in addition to the usual download statuses. When
"Anonymize History Links" is on (Settings → Privacy), `url` becomes a deterministic hash
placeholder (`"hidden-<12 hex chars>"` — the same URL always anonymizes to the same string) and
`title`/`thumbnail` are nulled too (a title alone can leak what was downloaded).

`POST /api/history/:id/retry` — no body. Re-queues from the entry's URL, reusing the original
type/quality/collection/folder/filename/audioFormat when the source download row still exists.
Response `201 {"id": <newDownloadId>}`.

`DELETE /api/history/:id` — `404` unknown, `204` success, permanent.

`POST /api/history/clear` — no body, deletes every entry regardless of age. `200 {"deleted": <n>}`.

## Logs

| Method | Path |
|---|---|
| GET | `/api/logs` |

No params. Returns the most recent **200** download rows (hard-capped) with their captured yt-dlp
invocation:

```json
{
  "id": 42, "title": "Some Video", "url": "https://...", "status": "completed",
  "ytdlpCommand": "yt-dlp --dump-json ...", "exitCode": 0,
  "stdoutTail": "...", "stderrTail": "...", "retryCount": 0,
  "errorMessage": null, "createdAt": "...", "completedAt": "..."
}
```

`stdoutTail`/`stderrTail` are the last ~8000 characters. Same URL/title anonymization as History,
gated by the same setting.

## Subscriptions

Periodically re-checks a saved channel/playlist URL for new uploads. A new upload either becomes a
ghost library placeholder for manual review, or — if auto-download is on — goes straight into the
download queue.

| Method | Path | Description |
|---|---|---|
| POST | `/api/subscriptions` | Create a subscription (baselines existing uploads as already-seen) |
| GET | `/api/subscriptions` | List all subscriptions |
| PATCH | `/api/subscriptions/:id` | Update a subscription (full-state replace, not a partial merge) |
| DELETE | `/api/subscriptions/:id` | Delete a subscription (library items already created are kept) |
| POST | `/api/subscriptions/:id/check` | Check now — synchronous |
| GET | `/api/subscriptions/:id/entries` | List every upload ever seen ("Known items") |
| POST | `/api/subscriptions/:id/entries/:sourceId/add` | Add one known entry as a ghost or a download |
| POST | `/api/subscriptions/:id/entries/:sourceId/seen` | Dismiss one entry without acting on it |
| POST | `/api/subscriptions/:id/entries/:sourceId/link` | Manually associate an entry with an existing library item |
| POST | `/api/subscriptions/:id/entries/:sourceId/unlink` | Clear an entry's library item association |

### `POST /api/subscriptions`

```json
{
  "url": "https://youtube.com/@somechannel", "mediaType": "video", "collectionId": 4,
  "tags": ["music"], "autoDownload": false, "generateNfo": true, "checkIntervalHours": 6
}
```

`url` (http/https) and `mediaType` (`video`|`audio`) required; `checkIntervalHours` defaults to 6
if omitted/zero. `400` bad URL/missing fields, `422` initial metadata fetch failed. On success,
every upload currently at the URL is recorded as already-seen (baseline) — subscribing means "tell
me about new uploads from now on," not "queue the whole back catalog." Response `201`:

```json
{
  "id": 3, "url": "https://youtube.com/@somechannel", "title": "Some Channel",
  "mediaType": "video", "collectionId": 4, "collectionName": "Music Videos",
  "tags": ["music"], "autoDownload": false, "generateNfo": true,
  "checkIntervalHours": 6, "enabled": true,
  "lastCheckedAt": "2026-08-22T10:00:00Z", "lastCheckError": null,
  "knownEntryCount": 42, "unseenEntryCount": 0, "createdAt": "2026-08-22T10:00:00Z"
}
```

### `PATCH /api/subscriptions/:id`

```json
{ "collectionId": 4, "tags": ["music"], "autoDownload": true, "generateNfo": true, "checkIntervalHours": 12, "enabled": true }
```

`url`/`mediaType` are immutable after creation (changing the source is really delete-and-re-add).
Every other field required (a real `false`/`0` must be distinguishable from "omitted"). `404`
unknown id, `200` with the full updated subscription.

### `POST /api/subscriptions/:id/check` — no body

Same code path as the scheduled sweep, for one subscription, blocking until yt-dlp responds. `404`
unknown id, `502` fetch failure (still records the attempt so it isn't retried every tick).
Response `200 {"newItemsFound": 2}`.

### `GET /api/subscriptions/:id/entries` — no params

Every upload ever seen for this subscription, most-recently-first-seen first
(`first_seen_at DESC, id DESC` — the tiebreak matters because every entry baselined at subscribe
time shares the exact same `firstSeenAt`, so sorting on that column alone left ties in
undefined/unstable order):

```json
[
  {
    "sourceId": "abc123", "title": "New Upload", "url": "https://youtube.com/watch?v=abc123",
    "durationSeconds": 214.0, "libraryItemId": null,
    "seenAt": null, "firstSeenAt": "2026-08-22T09:00:00Z",
    "linkedLibraryItemId": null, "linkedLibraryItemIsGhost": false
  }
]
```

`seenAt: null` means unseen ("New"). An entry recorded before this feature tracked full details has
empty `title`/`url` and `null` `durationSeconds`. `sourceId` is usually the extractor's native video
ID, but falls back to the entry's URL for sources whose flat-playlist listing doesn't provide one —
either way it's stable and unique per subscription. An entry that fails to auto-download/auto-ghost
during a check is still recorded here (`libraryItemId: null`, unseen) rather than silently dropped —
without that, a persistent failure would retry (and fail) on every future check indefinitely, never
visible anywhere. `linkedLibraryItemId`/`linkedLibraryItemIsGhost` report the library item this
entry is *effectively* associated with, if any: `libraryItemId` (set by a prior ghost/download, or
by `/link` below) when present, otherwise a fallback URL/video-id soft match against the whole
library — so a video already present through some other route (a manual download, a different
subscription, an import, or an explicit manual link) shows up linked here even when `libraryItemId`
itself is `null`.

### `POST /api/subscriptions/:id/entries/:sourceId/add`

```json
{ "mode": "ghost" }
```

`mode` is `"ghost"` (creates a library placeholder immediately, for review) or `"download"` (queues
a real download right now) — both mark the entry seen as a side effect. Re-adding an entry that's
already linked to a library item is allowed (the frontend confirms first when it detects this); an
existing link is left untouched rather than overwritten by the new ghost/download. `404` unknown
subscription/entry, `400` no URL recorded for a pre-tracking entry, `502` ghost-create/enqueue
failure. Response `200 {"mode": "ghost", "libraryItemId": 118}` or
`{"mode": "download", "downloadId": 55}`.

### `POST /api/subscriptions/:id/entries/:sourceId/seen` — no body

Dismisses one entry without creating anything. `404` unknown entry, `204`.

### `POST /api/subscriptions/:id/entries/:sourceId/link`

```json
{ "libraryItemId": 25 }
```

Manually associates this entry with an existing library item — for when the video was actually
downloaded through a different source/URL than the one this subscription tracks, so the automatic
URL/video-id match could never have found it on its own (surfaced in the "Known items" dialog as
"Link to library item…", a plain search-and-pick over the whole library). Also marks the entry seen.
Multiple entries — even across different subscriptions — can link to the same library item. `404`
unknown subscription/entry/library item, `204` on success.

### `POST /api/subscriptions/:id/entries/:sourceId/unlink` — no body

Clears an entry's manual/auto library item association (`libraryItemId` back to `null`) without
touching the library item itself or the entry's seen state. A soft URL/video-id match, if one still
applies, keeps showing as linked in `linkedLibraryItemId` regardless. `404` unknown
subscription/entry, `204`.

### Automatic checking

Runs on the **same shared hourly ticker** as history/log/thumbnail-enhancement cleanup and
scheduled backups (see [architecture.md](architecture.md)) — once at startup, then every hour. A
subscription is due when `enabled` and `now - lastCheckedAt >= checkIntervalHours` (options: 1h,
6h, 12h, 24h). Each due subscription is checked independently; one failing (dead URL, network
error) is logged and skipped, never blocks the rest. Disabling a subscription only stops the
scheduled checks — "Check now" still works manually while disabled.

## Stats

| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Headline dashboard counts |
| GET | `/api/stats/library-growth` | Cumulative library item count over time |
| GET | `/api/stats/resolution-breakdown` | Item counts bucketed by resolution step |

No params on any of the three.

```json
{
  "activeDownloads": 2, "queuedDownloads": 5, "completedToday": 14,
  "libraryVideoCount": 320, "libraryAudioCount": 48, "libraryImageCount": 6,
  "libraryVideoGhostCount": 3, "libraryAudioGhostCount": 1, "libraryImageGhostCount": 0,
  "totalStorageBytes": 128849018880,
  "diskTotalBytes": 500107862016, "diskFreeBytes": 128849018880
}
```

`libraryVideo/Audio/ImageGhostCount` are ghost-item (no downloaded file) counts, separate from the
real counts — ghost items are never created with `mediaType=image` today, so
`libraryImageGhostCount` is currently always `0`. `diskTotal/FreeBytes` are best-effort (`0`/`0` if
the filesystem call fails — never fails the whole request).

### `GET /api/stats/library-growth`

Backs the Dashboard "Library Growth" chart — one point per day with any activity, oldest first,
`cumulative` a true running total over the item's entire history:

```json
[
  { "date": "2026-08-18", "count": 3, "cumulative": 314 },
  { "date": "2026-08-20", "count": 6, "cumulative": 320 }
]
```

### `GET /api/stats/resolution-breakdown`

Backs the Dashboard "Items by Resolution" chart — always returns all six standard steps even at
zero, so the chart renders a consistent, fully-labeled bar set:

```json
[
  { "step": 480, "count": 12 }, { "step": 720, "count": 40 }, { "step": 1080, "count": 210 },
  { "step": 1440, "count": 8 }, { "step": 2160, "count": 44 }, { "step": 4320, "count": 0 }
]
```

## Jellyfin

| Method | Path |
|---|---|
| POST | `/api/jellyfin/rescan` |

No body. Triggers a full Jellyfin library scan on demand — there's no automatic trigger tied to
every download (that would mean a burst of rescans during a busy queue); the app instead
auto-triggers/debounces internally per the `jellyfinRefreshMode` setting, and this route is the
manual override. `400` if Jellyfin isn't enabled or configured, `502` if the Jellyfin API call
fails, `204` on success.

## yt-dlp

| Method | Path | Description |
|---|---|---|
| GET | `/api/ytdlp/version` | Current + latest available version |
| POST | `/api/ytdlp/update` | Upgrade yt-dlp via pip |

```json
{ "currentVersion": "2024.08.06", "latestVersion": "2024.09.27", "updateAvailable": true }
```

`latestVersion` is `null` if the best-effort PyPI lookup fails (that alone never fails the
request). `POST /api/ytdlp/update` — no body, `502` on failure, else `200 {"version": "2024.09.27"}`.

## Proxy

The `ytdlp_proxy` setting (Settings → yt-dlp → Proxy, e.g. `socks5://127.0.0.1:1080` or
`http://gluetun:8888`) is read by every outbound fetch that would otherwise leak the server's real
network path: yt-dlp's own `--proxy` flag, `downloadType=image` downloads, and both New Download
preview paths (`GET /api/downloads/preview-image`, above) — a raw client-side `<img src>` fetch has
no way to honor a backend-configured proxy, so those are proxied server-side instead.

| Method | Path | Description |
|---|---|---|
| GET | `/api/proxy/status` | Whether a proxy is configured and currently reachable |

```json
{ "configured": true, "reachable": true }
```

`configured: false` (with `reachable` meaningless/`false`) means no `ytdlp_proxy` is saved — nothing
to probe. When configured, the backend makes a short-timeout (5s) `HEAD` request through it to a
fixed external address to confirm it's actually passing traffic. Backs the sidebar's Downloads
status dot (grey = unconfigured, green = reachable, red = configured but not reachable), polled
every 30s.

## AI Enhancement

See [FEATURES.md](FEATURES.md#ai-enhancement) for what this does and how the three triggers
(manual/scheduled/auto-on-download) work — this is just the endpoint surface.

| Method | Path | Description |
|---|---|---|
| GET | `/api/thumbnail-enhancement/history` | Paginated/searchable attempt history |
| DELETE | `/api/thumbnail-enhancement/history/:id` | Delete one history entry |
| POST | `/api/thumbnail-enhancement/history/bulk-delete` | Delete many history entries |
| POST | `/api/thumbnail-enhancement/history/clear` | Delete every history entry |
| POST | `/api/thumbnail-enhancement/run` | Run a sweep now ("Enhance Now") |
| GET | `/api/thumbnail-enhancement/upscalers` | List upscaler models from a (possibly unsaved) instance URL |
| GET | `/api/thumbnail-enhancement/status` | Configured/reachable status |
| GET | `/api/thumbnail-enhancement/eligible` | Every currently-eligible item (uncapped) |
| POST | `/api/thumbnail-enhancement/items/bulk-run` | Enhance a specific set of items now |
| POST | `/api/thumbnail-enhancement/items/bulk-sharpen` | Sharpen (denoise/detail, no resize) a specific set |
| POST | `/api/thumbnail-enhancement/items/:id/revert` | Revert one item to its pre-enhancement backup |
| DELETE | `/api/thumbnail-enhancement/items/:id/original` | Discard one item's backup, keep the enhanced result |
| POST | `/api/thumbnail-enhancement/items/bulk-keep-enhanced` | Bulk-commit enhanced thumbnails, freeing backups |
| POST | `/api/thumbnail-enhancement/items/bulk-keep-original` | Bulk-revert to pre-enhancement thumbnails |

### `GET /api/thumbnail-enhancement/history?q=&status=&trigger=&mode=&page=1`

Fixed page size 25:

```json
{
  "entries": [
    {
      "id": 88, "libraryItemId": 118, "itemTitle": "Some Video",
      "status": "success", "originalWidth": 320, "originalHeight": 180,
      "enhancedWidth": 1280, "enhancedHeight": 720,
      "originalSizeBytes": 8421, "enhancedSizeBytes": 94213, "error": null,
      "createdAt": "2026-08-22T10:00:00Z", "hasOriginalBackup": true,
      "originalThumbnailPath": "thumbnail-backups/118/orig.webp",
      "enhancedThumbnailPath": "Music Videos/Some Video.jpg",
      "revertedAt": null, "triggerType": "manual", "mode": "upscale"
    }
  ],
  "total": 214
}
```

`status` is `"success"`/`"failed"`; `triggerType` is `"manual"`/`"scheduled"`/`"auto"`; `mode` is
`"upscale"`/`"sharpen"`. `hasOriginalBackup`/`originalThumbnailPath`/`enhancedThumbnailPath`
reflect the item's *current* live state, not this specific row — only the most recent success per
item is eligible for Compare/Revert. `originalThumbnailPath` is served via `/local-images/*`,
`enhancedThumbnailPath` via `/media-files/*` — different roots.

`DELETE .../history/:id` — `404`/`204`. `POST .../history/bulk-delete` — `{"ids":[...]}` →
`200 {"deleted": n}` (unknown ids skipped). `POST .../history/clear` — `200 {"deleted": n}`.

### `POST /api/thumbnail-enhancement/run` — no body

Fire-and-forget: counts eligible items synchronously, runs the sweep detached from the request,
responds immediately. `202 {"queued": 7}`. Progress streams over the `enhance_progress` WebSocket
event (see WebSocket, below) rather than blocking this response.

### `GET /api/thumbnail-enhancement/upscalers?url=...&username=...&password=...`

Tests against whatever's currently typed into the Settings form, not necessarily saved yet. `400`
missing `url`, `502` on failure. `200 {"upscalers": ["R-ESRGAN 4x+", "..."]}`.

### `GET /api/thumbnail-enhancement/status` — no params

```json
{ "configured": true, "reachable": false, "error": "dial tcp: connection refused" }
```

`configured: false` (feature off, or no URL saved) short-circuits to just `{"configured": false}`.

### `GET /api/thumbnail-enhancement/eligible` — no params

Every item the next sweep would pick up, uncapped (a real run stops at the sweep cap):

```json
[
  {
    "libraryItemId": 118, "itemTitle": "Some Video", "width": 320, "height": 180,
    "artistName": "Some Artist", "collectionName": "Music Videos", "recentlyFailedAt": null
  }
]
```

`recentlyFailedAt` is set when the item's last attempt failed within the past hour — automatic
runs skip it during that cooldown, but it still shows here so it stays manually retryable.

### `POST /api/thumbnail-enhancement/items/bulk-run` / `.../items/bulk-sharpen`

```json
{ "itemIds": [1, 2, 3] }
```

`itemIds` required, at least one. `202 {"queued": 3}`. Fire-and-forget; bypasses the sweep cap and
ignores the failure cooldown (explicit selection).

### `POST /api/thumbnail-enhancement/items/:id/revert` / `DELETE .../items/:id/original`

No body either way. `404 {"error":"no original backup for this item"}` if none, else `204` —
revert restores the pre-enhancement thumbnail and discards the enhanced version; delete-original
does the opposite (commits the enhanced result, frees the backup).

### `POST /api/thumbnail-enhancement/items/bulk-keep-enhanced` / `.../items/bulk-keep-original`

```json
{ "itemIds": [1, 2, 3] }
```

`200 {"updated": 2, "skipped": 1}` — an item with no backup (already committed/reverted/never
enhanced) is skipped, not fatal.

## Media files

| Method | Path |
|---|---|
| GET | `/media-files/*path` |

Static file server rooted at `MEDIA_ROOT`. Requires a valid session cookie but no CSRF header
(GET-only). Responses carry `Cache-Control: no-cache` (not `no-store`) — still revalidates cheaply
via `If-Modified-Since`, but never assumes a stale byte range is fresh, since sidecar thumbnails
get overwritten in place at the same path.

## WebSocket

| Method | Path |
|---|---|
| GET | `/ws` |

Requires a valid session cookie (carried by the upgrade request). Server → client only — the
socket exists purely to push live deltas; there is no initial snapshot on connect, so the client
fetches current state via REST first and then listens for updates. Ping every 54s, 10s write
deadline; a slow/backed-up client is dropped rather than blocking broadcasts for everyone else.

Each message is `{ "type": "...", "payload": {...} }`. Six event types are ever broadcast:

**`progress`** — emitted repeatedly during an active download, throttled to roughly once/sec:
```json
{
  "type": "progress",
  "payload": {
    "downloadId": 42, "status": "downloading", "percent": 43.2,
    "speedBytesPerSec": 1048576, "etaSeconds": 12,
    "downloadedBytes": 5242880, "totalBytes": 12058624
  }
}
```

**`completed`** — once, on success:
```json
{ "type": "completed", "payload": { "downloadId": 42, "libraryId": 118, "title": "Some Video" } }
```

**`failed`** — once, on failure, timeout, or cancel (`status` distinguishes them; a timeout still
uses `"failed"` with a timeout-specific message — `status` is only ever `"failed"` or `"cancelled"`):
```json
{ "type": "failed", "payload": { "downloadId": 42, "status": "failed", "error": "yt-dlp exited 1: ..." } }
```

**`queue_update`** — emitted alongside progress ticks, aggregate queue depth:
```json
{ "type": "queue_update", "payload": { "active": 2, "queued": 5 } }
```

**`enhance_progress`** — one per library item as an AI-enhancement sweep runs, regardless of which
trigger (scheduled, "Enhance Now," bulk-selected, or auto-on-download) started it:
```json
{ "type": "enhance_progress", "payload": { "libraryItemId": 118, "itemTitle": "Some Video", "status": "processing", "error": null } }
```
`status` is `"processing"`, `"success"`, or `"failed"` (then `error` is set).

**`frame_match_progress`** — one per frame-match queue row as it changes state, regardless of
trigger (single ad-hoc job or bulk queue):
```json
{ "type": "frame_match_progress", "payload": { "queueId": 7, "libraryItemId": 118, "itemTitle": "Some Video", "state": "done", "error": null } }
```
`state` is `"running"`, `"done"`, or `"error"` (then `error` is set).

The WebSocket is a live-delta channel only — clients should treat `GET /api/downloads` and
`GET /api/library` as the source of truth on initial load and on reconnect.
