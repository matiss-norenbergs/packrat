# Architecture

Packrat's backend is a Go/Gin service with SQLite (WAL mode) storage; the frontend is a
React/TypeScript SPA served by the same binary in production. See the root
[`docker-app-plan.md`](../../docker-app-plan.md) for the full long-term spec — this document
covers what is actually implemented in the current working skeleton.

## Backend package layout

```
backend/
  cmd/server/main.go     entrypoint: config, DB, migrations, queue, WS hub, HTTP server
  internal/
    config/               env-var configuration
    db/                    SQLite connection (WAL, busy_timeout) + migration runner
    models/                domain structs (Download, LibraryItem, ...)
    repository/            database/sql-based repositories, no ORM
    downloader/             yt-dlp subprocess wrapper: metadata fetch, args, progress parsing
    queue/                  worker-pool DownloadManager + in-memory ProgressStore
    api/                    Gin router, handlers, DTOs
    ws/                     WebSocket hub/client, event types
    pathsafe/                path traversal prevention
    fsutil/                  filename sanitization, directory helpers
```

## Data flow (the one implemented end-to-end flow)

1. `POST /downloads` validates the request, resolves the destination folder against
   `MEDIA_ROOT` via `pathsafe.ResolveUnderRoot`, inserts a `queued` row, and pushes the ID onto
   the queue manager's job channel.
2. A worker goroutine (one of `MAX_CONCURRENT_DOWNLOADS`) picks up the job, fetches metadata via
   `yt-dlp --dump-json`, then runs the actual download with `--progress-template` emitting
   structured progress lines.
3. Progress is kept in an in-memory `ProgressStore` and flushed to SQLite only on status change,
   per the SQLite Concurrency requirement — the DB is never written to on every progress tick.
4. Progress/completed/failed/queue_update events are broadcast over WebSocket, throttled to
   roughly once per second per download.
5. On success, a `library` row is created and the frontend's Library page picks it up (via WS
   `completed` event triggering a refetch).

## Deliberate scope cuts

These are cut from this pass, not forgotten — see the roadmap in `docker-app-plan.md` for when
they belong:

- **No filename templating engine.** The spec's `{title}/{channel}/{date}` template variables are
  not implemented. A blank filename uses yt-dlp's native `%(title)s`; a provided filename is used
  literally (sanitized).
- **No FTS5 search table yet.** The Library page has no search UI this pass, so the `library`
  table has plain indexes only. Add the FTS5 virtual table in a migration when search is built.
- **Concurrency limit is fixed at process startup.** `MAX_CONCURRENT_DOWNLOADS` sets the worker
  pool size once; changing it requires a restart.
- **No auth, CSRF, or rate limiting.** The app is intended for a trusted local network only in
  this pass. WebSocket has no origin restriction (`CheckOrigin` always returns true).
- **`history`, `tags`, `library_tags`, `collections` tables exist but are inert.** They're in the
  schema (matching the spec's Database section) so a future migration doesn't need to add them
  from scratch, but no handler reads or writes `history` yet, and there is no Collections CRUD UI
  — downloads are effectively "Uncategorized" unless a `collectionId` is passed directly via the
  API.
- **No postprocessing progress signal.** yt-dlp does not reliably emit progress-template events
  during the ffmpeg merge/extract step for the format selectors this app uses, so there is a
  window after "downloading" reaches 100% before the process actually exits where no progress
  event fires. This is expected, not a bug.

## Crash recovery

On startup, `DownloadsRepo.MarkInterruptedIfActive` scans for rows left in `queued`,
`fetching_metadata`, `downloading`, or `processing` status (i.e. anything a crashed/restarted
process was mid-flight on) and marks them `interrupted`. Nothing is silently resumed — the user
must manually retry from the Downloads page.
