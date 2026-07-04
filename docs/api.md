# API

Base URL: same origin as the web UI (the Go binary serves both the API and the built frontend).
No authentication in this pass — see [`architecture.md`](architecture.md) for scope cuts.

All JSON API routes live under `/api` — this is deliberate, not a style choice: the frontend has
client-side routes named `/downloads`, `/library`, and `/collections` too, and without the prefix
a hard refresh (or a shared link) on those pages would hit the API route instead of the app shell,
since Gin matches registered routes before falling back to serving `index.html`. `/media-files` and
`/ws` stay unprefixed since no frontend route shares those names.

## REST

| Method | Path                      | Description                                                        |
|--------|---------------------------|----------------------------------------------------------------------|
| GET    | `/api/health`             | Liveness/readiness check; pings the database.                       |
| POST   | `/api/downloads`          | Queue a new download. Body: `CreateDownloadRequest` (see below).    |
| GET    | `/api/downloads`          | List all downloads, DB rows merged with live in-memory progress.    |
| DELETE | `/api/downloads/:id`      | Cancel a queued or in-flight download.                              |
| GET    | `/api/library`            | List all completed library items.                                   |
| GET    | `/api/collections`        | List all collections.                                               |
| POST   | `/api/collections`        | Create a collection. Body: `CreateCollectionRequest` (see below).    |
| PATCH  | `/api/collections/:id`    | Update a collection (full replace of the editable fields).          |
| DELETE | `/api/collections/:id`    | Delete a collection. Downloads/library items referencing it fall back to uncategorized (`ON DELETE SET NULL`). |
| GET    | `/media-files/*path`      | Serve a file (media or thumbnail) from under `MEDIA_ROOT`.           |
| GET    | `/ws`                     | Upgrade to a WebSocket connection for live events (see below).      |

### `CreateDownloadRequest`

```json
{
  "url": "https://...",
  "collectionId": null,
  "folder": "",
  "filename": "",
  "downloadType": "video",
  "quality": "best",
  "audioFormat": "mp3"
}
```

`url` and `downloadType` (`"video"` or `"audio"`) are required. `folder` is validated to resolve
under the effective root (the selected collection's folder, or `MEDIA_ROOT` if none) — anything
else is rejected with `400`. If `collectionId` is set and `quality` is omitted, the collection's
`defaultQuality` is used instead of the global default (`best`).

### `CreateCollectionRequest` / `UpdateCollectionRequest`

```json
{
  "name": "Music",
  "rootPath": "Music",
  "defaultQuality": "best",
  "defaultDownloadType": "audio"
}
```

`name` and `rootPath` are required; `rootPath` is a folder name resolved under `MEDIA_ROOT` (see
[`architecture.md`](architecture.md) for why this isn't an arbitrary filesystem path, unlike the
spec's literal examples), not an absolute path — `400` if it resolves outside `MEDIA_ROOT`, `409`
if `name` collides with an existing collection.

## WebSocket events

Each message is `{ "type": "...", "payload": {...} }`.

| type            | payload                                                                 |
|-----------------|--------------------------------------------------------------------------|
| `progress`      | `downloadId, status, percent, speedBytesPerSec, etaSeconds, downloadedBytes, totalBytes` |
| `completed`     | `downloadId, libraryId, title`                                          |
| `failed`        | `downloadId, status ("failed"\|"cancelled"), error`                      |
| `queue_update`  | `active, queued`                                                        |

`progress` events are throttled to roughly one per second per download. The WebSocket is a
live-delta channel only — clients should treat `GET /api/downloads` and `GET /api/library` as the
source of truth on initial load and reconnect.
