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

`url` (must be a URL) and `downloadType` (`video`|`audio`) are required; everything else is
optional. Notes:

- If `collectionId` is set and `quality` is omitted, the collection's `defaultQuality` is used;
  else the app-wide `defaultQuality` setting; else `"best"`.
- `audioFormat` defaults to `"mp3"` when `downloadType=audio` and it's omitted.
- `folder`/`collectionId` are validated with path-traversal protection *synchronously* — an
  invalid folder or unknown collection is a `400`, not a later async failure.
- `title`/`artistId`/`year`/`seasonNumber`/`sequenceNumber`/`filenamePrefix` are **overrides
  applied once the download completes**, taking priority over whatever yt-dlp reports.
- `tags` are applied to the resulting library item on completion (created if missing).
- Response: `201 {"id": 42}`.

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
| POST | `/api/library/:id/redownload` | Re-queue a fresh download from the source URL |
| POST | `/api/library/:id/thumbnail/redownload` | Re-fetch just the thumbnail |
| POST | `/api/library/:id/thumbnail/quick-grab` | Grab one random video frame as thumbnail |
| GET | `/api/library/:id/thumbnail/candidates` | Extract N candidate frames (read-only) |
| POST | `/api/library/:id/thumbnail` | Set the thumbnail from a supplied image |
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
  "thumbnail": "Music Videos/Some Video.jpg", "description": "...",
  "artistId": 3, "artistName": "Some Artist", "year": 2023,
  "sequenceNumber": null, "seasonNumber": 2, "generateNfo": true, "nfoExists": true,
  "downloadedAt": "2026-07-19T10:02:00Z", "status": "completed", "blurred": false,
  "fileSizeBytes": 84213099, "tags": ["music", "live"]
}
```

`blurred` is true if the item's collection (or an ancestor) is private, **or** any of its tags is
marked private. `tags` is never `null` — `[]` if none.

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

### `POST /api/library/:id/redownload` — no body

Re-queues a download from `originalUrl`, reusing the exact original type/quality/filename/
audioFormat if the originating download row still exists, else falling back to app defaults.
`400` no source URL. Response `201 {"id": <newDownloadId>}`.

### Thumbnails

- **`POST /api/library/:id/thumbnail/redownload`** — no body. Re-fetches the thumbnail from
  `originalUrl`, overwriting the current one. `400` no source URL, `502` fetch failure.
- **`POST /api/library/:id/thumbnail/quick-grab`** — no body. Extracts one video frame at a random
  timestamp (avoiding the blank-ish first/last 10%) and sets it immediately. `502` if extraction
  fails.
- **`GET /api/library/:id/thumbnail/candidates`** — no body, read-only. Extracts N frames (N = the
  `thumbnailFrameCount` setting: 2/4/6/8) spread across the video as base64 JPEGs. A per-candidate
  failure is skipped, not fatal; `502` only if zero candidates could be extracted.
  ```json
  { "candidates": [ { "timestampSeconds": 34.2, "imageBase64": "/9j/4AAQ..." } ] }
  ```
- **`POST /api/library/:id/thumbnail`** — `{ "imageBase64": "/9j/4AAQ..." }`. Writes the given
  bytes as the thumbnail — finalize step for "choose from video." `400` invalid base64. All three
  thumbnail endpoints respond `200` with the full updated library item.

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

### `GET /api/collections`

```json
{
  "id": 7, "name": "Anime", "parentId": 2, "rootPath": "Anime", "path": "Shows/Anime",
  "defaultQuality": "1080p", "defaultDownloadType": "video", "isPrivate": false,
  "seasonNumber": 2, "artistId": null, "itemCount": 12,
  "effectiveIsPrivate": false, "totalItemCount": 40,
  "jellyfinLibraryId": "3c8f6b1a-...", "createdAt": "...", "updatedAt": "..."
}
```

`isPrivate`/`itemCount` are this collection's own flag and direct item count; `effectiveIsPrivate`
(this OR any ancestor private) and `totalItemCount` (own + all descendants) are the
inheritance-aware versions used by things like the Library toolbar's reveal-all control.

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

## Artists

Identical pattern to Tags, minus `isPrivate`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/artists` | List all artists |
| POST | `/api/artists` | Create an artist |
| PATCH | `/api/artists/:id` | Rename an artist |
| DELETE | `/api/artists/:id` | Delete an artist |
| POST | `/api/artists/bulk-delete` | Delete many at once |

`Artist`: `{id, name, createdAt, usageCount}`. Body: `{ "name": "..." }`. `409` on name conflict.
Deleting an artist referenced elsewhere doesn't fail — the foreign key is `ON DELETE SET NULL`.

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
  "thumbnailFrameCount": 4, "privacyBlurStrength": "default", "skipDownloadPreview": false,
  "jellyfinEnabled": false, "jellyfinUrl": "", "jellyfinApiKey": "", "jellyfinRefreshMode": "none",
  "libraryAutoplay": true
}
```

`downloadDirectory` and `maxConcurrentDownloads` reflect live config/worker-pool state, not just
the last saved DB value. `jellyfinApiKey` is returned in plaintext, not masked.

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

## Backup

| Method | Path | Description |
|---|---|---|
| POST | `/api/backup/export/settings` | Export all settings to a portable bundle |
| POST | `/api/backup/export/library` | Export collections/tags/artists/library refs |
| POST | `/api/backup/import/settings` | Import a settings bundle |
| POST | `/api/backup/import/library` | Import a library bundle |

Every export/import shares an envelope wrapper:

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

### `POST /api/backup/import/settings` / `POST /api/backup/import/library`

```json
{ "data": "{\"packrat\":true,\"version\":1,...}", "password": null }
```

`data` is the raw text of a previously-exported file. Parses the envelope, checks `kind` matches
the endpoint (`400` if not), decrypts if needed (`400` on wrong password). Settings import
overwrites every key present in the bundle (never deletes keys absent from it) and live-resizes
the worker pool if `maxConcurrentDownloads` was included:

```json
{ "applied": 23 }
```

Library import **merges**: matches collections by path and tags/artists by name, creates only
what's missing, never deletes anything (a name collision on one entry is skipped, not fatal). Then
re-queues an actual download for every resolved item, independently and best-effort — one bad
URL/folder doesn't abort the rest. A missing `downloadType` is inferred from the filename
extension before falling back to the app default.

```json
{ "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 12 }
```

Common errors for both import endpoints: `400` for a non-Packrat file, wrong `kind`, or a wrong
password; `500` otherwise.

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

## Stats

| Method | Path |
|---|---|
| GET | `/api/stats` |

No params.

```json
{
  "activeDownloads": 2, "queuedDownloads": 5, "completedToday": 14,
  "libraryVideoCount": 320, "libraryAudioCount": 48, "totalStorageBytes": 128849018880
}
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

Each message is `{ "type": "...", "payload": {...} }`. Exactly four event types are ever broadcast:

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

The WebSocket is a live-delta channel only — clients should treat `GET /api/downloads` and
`GET /api/library` as the source of truth on initial load and on reconnect.
