# Features

A guide to every page in Packrat and how it works. For the underlying architecture (backend
package layout, data flow, deliberate scope cuts), see [`architecture.md`](architecture.md); for
the raw REST surface, see [`api.md`](api.md).

## Dashboard

The landing page. Two cards summarize current state at a glance:

- **Downloads** — active, queued, and completed-today counts, with a link to the Downloads page.
- **Library** — video count, audio count, and total storage used across the whole library.

Read-only — it's a summary view, not a control panel.

## Downloads

The live download queue.

- **New Download** — paste any URL `yt-dlp` supports. Pick a collection (optional — inherits that
  collection's default type/quality when selected), video or audio, quality/format, and an
  optional filename override (defaults to the source's title).
- **Bulk Download** — queue several URLs at once from a set of rows (each with its own
  collection/type/quality/format), or paste a list of URLs (one per line) into a textarea and add
  them all as rows in one go. Up to 50 rows per batch.
- **Queue list** — each row shows a thumbnail, title, status badge, and live progress (percent,
  speed, ETA) while downloading, streamed over WebSocket rather than polled. A failed or
  interrupted row shows its error message inline.
  - While a download is still in flight (queued/fetching metadata/downloading/processing), the
    row's action button **cancels** it.
  - Once it reaches a terminal state (completed/failed/cancelled/interrupted), the button instead
    **removes it from the queue list** (with a confirmation) — this only deletes the queue-history
    row, never the downloaded file itself.

If the backend process restarts mid-download, anything left `queued`/`downloading`/etc. is marked
`interrupted` on the next startup — nothing is silently auto-resumed; retry it manually (from
Downloads or History).

## Library

Your completed downloads (and anything imported — see Import below).

**View modes**, toggled in the toolbar and remembered across reloads/browsers (stored server-side,
not per-browser):
- **Grid** — a flat, filterable grid of every item.
- **Folders** — browse by collection, one level at a time, with a breadcrumb trail and
  browser-back support for navigating up.

**Toolbar**: free-text search (title/uploader/artist/description), a sort key (date downloaded,
title, filename, year, duration) + ascending/descending toggle (also remembered server-side), a
collection filter (Grid view only), and a year filter.

**Per-item actions** (the "⋮" menu on each card):
- **Edit** — title, filename (renames the file on disk), uploader, duration, resolution, artist,
  year, description, and the original source URL are all editable. Editing title/artist/year also
  re-embeds those tags into the actual media file's container metadata in the background (an
  `ffmpeg -c copy` remux) — the Save action itself returns immediately rather than waiting for
  that to finish.
- **Copy URL** — copies the item's original source URL to the clipboard (disabled if it has none,
  e.g. items imported without a source URL).
- **Move** — relocate the file to a different collection and/or folder.
- **Refresh Metadata** — re-fetches title/uploader/duration/resolution/description from the
  original source URL, overwriting any manual edits (with a confirmation, since it's destructive
  to those edits). Never touches the file or thumbnail.
- **Redownload** — re-queues a fresh download using the item's original URL and its original
  type/quality/format if that download record still exists, falling back to app defaults
  otherwise.
- **Thumbnail** submenu:
  - **Redownload from URL** — re-fetches the thumbnail image from the source.
  - **Quick Grab** — grabs one random frame from the video file itself.
  - **Choose from Video…** — extracts several candidate frames spread across the video (2/4/6/8,
    configurable in Settings) and lets you pick one.
- **Delete** — "Remove from library" deletes only the database entry (file stays on disk);
  "Delete files too" also removes the media file and thumbnail from disk.

Private collections (see Collections below) blur their items' thumbnails everywhere they appear
(Library cards and the Downloads queue) until hovered/clicked.

## Collections

Named presets — a folder under your media root plus a default download type and quality —
selectable from the New Download dialog so you don't have to re-pick them every time.

- Collections nest (sub-collections), shown as a tree; a collection's position in the tree is
  fixed at creation and can't be moved later.
- **Private** — marking a collection private blurs thumbnails for everything in it (and its
  sub-collections) throughout the app, shown with a lock icon in the tree.
- Deleting a collection does not delete the files inside it — downloads/library items just lose
  their collection association.

## Import

For files placed directly under your media root from outside the app (e.g. copied in manually,
or downloaded by some other tool) — brings them into the Library without re-downloading anything.

- **Rescan** re-scans the media root for files not already in the Library, showing size, duration,
  resolution, and which collection folder (existing or new) each one would land in.
- Select individual files or **Import All** — each import probes the file with `ffprobe` and
  creates a Library entry for it. You can optionally attach an original source URL per file (so
  Redownload/Refresh Metadata work on it later) — imports without one just skip those actions.
  Imported rows are greyed out and can't be re-imported; the scan list itself doesn't
  auto-refresh after every import, only on page load or manual Rescan.
- **Ignored Folders** — mark specific folders (and their sub-folders) to be skipped in future
  scans entirely, e.g. a raw-footage or behind-the-scenes folder you never want surfaced here.

## History

A permanent record of every download attempt — completed, failed, or cancelled — that is never
removed when the corresponding entry is deleted from the Downloads queue.

- Shows title/URL, status, timestamp, and the error message for failures.
- **Retry** re-queues a fresh download for any non-completed entry (failed/cancelled/interrupted),
  reusing the original type/quality/format/collection/filename where the source download record
  still exists.
- If "Anonymize History Links" is on (Settings → Privacy), URLs here are shown as a short
  deterministic hash instead of the real link — the same URL always hashes to the same value, but
  the underlying link isn't exposed. Retry still works either way.

## Settings

- **General** — max concurrent downloads (applies to the live worker pool immediately, no
  restart needed), default download type and quality for new downloads. Download directory is
  shown but not editable here (set via the `MEDIA_ROOT` environment variable).
- **Privacy** — "Anonymize History Links" toggle (see History above).
- **Thumbnails** — how many candidate frames "Choose from Video" offers (2/4/6/8).
- **Appearance** — light / dark / system theme.

All settings save immediately on change — there's no separate "Save" step for these cards (except
the General card, which batches its three fields behind one Save button).

## Logs

A debugging view over every download's captured yt-dlp invocation — the exact command that ran,
its exit code, and the last ~8000 characters of its stdout/stderr — for both successful and
failed downloads.

- Free-text search matches against title/URL and the captured command; a status filter narrows
  the list to one download status.
- **View log** opens the full detail for a row: command, exit code, and the stdout/stderr tails
  in scrollable monospace blocks, each with its own copy-to-clipboard button. The button is
  disabled (with a tooltip) for rows that never got far enough to invoke yt-dlp at all (e.g. a
  still-queued download).
- Retry count is shown when a download needed more than one attempt.
- Respects the same "Anonymize History Links" setting as History (Settings → Privacy) — URLs are
  hashed the same way when that's enabled.
