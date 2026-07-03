# API

Base URL: same origin as the web UI (the Go binary serves both the API and the built frontend).
No authentication in this pass — see [`architecture.md`](architecture.md) for scope cuts.

## REST

| Method | Path                 | Description                                                        |
|--------|----------------------|----------------------------------------------------------------------|
| GET    | `/health`            | Liveness/readiness check; pings the database.                       |
| POST   | `/downloads`         | Queue a new download. Body: `CreateDownloadRequest` (see below).    |
| GET    | `/downloads`         | List all downloads, DB rows merged with live in-memory progress.    |
| DELETE | `/downloads/:id`     | Cancel a queued or in-flight download.                              |
| GET    | `/library`           | List all completed library items.                                   |
| GET    | `/media-files/*path` | Serve a file (media or thumbnail) from under `MEDIA_ROOT`.           |
| GET    | `/ws`                | Upgrade to a WebSocket connection for live events (see below).      |

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
under `MEDIA_ROOT` — anything else is rejected with `400`.

## WebSocket events

Each message is `{ "type": "...", "payload": {...} }`.

| type            | payload                                                                 |
|-----------------|--------------------------------------------------------------------------|
| `progress`      | `downloadId, status, percent, speedBytesPerSec, etaSeconds, downloadedBytes, totalBytes` |
| `completed`     | `downloadId, libraryId, title`                                          |
| `failed`        | `downloadId, status ("failed"\|"cancelled"), error`                      |
| `queue_update`  | `active, queued`                                                        |

`progress` events are throttled to roughly one per second per download. The WebSocket is a
live-delta channel only — clients should treat `GET /downloads` and `GET /library` as the source
of truth on initial load and reconnect.
