# Features

A guide to every page in Packrat and how it works. For the underlying architecture (backend
package layout, data flow, deliberate scope cuts), see [`architecture.md`](architecture.md); for
the raw REST surface, see [`api.md`](api.md).

Packrat requires signing in — the first time you open it, a one-time setup wizard creates the
single admin account (there's no multi-user support). See "Auth and CSRF" in
[`architecture.md`](architecture.md) for the session/CSRF mechanics.

## Dashboard

The landing page. Two cards summarize current state at a glance:

- **Downloads** — active, queued, and completed-today counts, with a link to the Downloads page.
- **Library** — video count, audio count, and total storage used across the whole library.

Read-only — it's a summary view, not a control panel.

## Downloads

The live download queue.

- **New Download** — paste any URL `yt-dlp` supports.
  - Pick a collection (optional). Selecting one inherits its default type/quality, and — if set —
    its Season # and Artist defaults (see Collections below); only fills those in, never clears a
    value you've already typed.
  - Video or audio, quality/format, and an optional filename override (defaults to the source's
    title).
  - A live preview card (thumbnail/title/uploader/duration) fetches before you submit, unless
    "I trust this source" is enabled in Settings → Downloads. If the URL matches something already
    in the library, a duplicate warning is shown but doesn't block submission.
  - **Playlists**: pasting a playlist URL offers a mode — download just the one video ("current"),
    the entire playlist, a numbered range, or the first N entries. The server re-resolves the
    playlist itself at submit time rather than trusting a client-built entry list.
  - **Advanced** section: Title/Artist/Year/Season #/Sequence # overrides (applied once the
    download completes, taking priority over whatever yt-dlp reports), Tags, and a "Generate NFO"
    checkbox (writes a Kodi/Jellyfin-style `.nfo` sidecar alongside the file).
- **Bulk Download** — queue several URLs at once from a set of rows (each with its own
  collection/type/quality/format/tags/advanced fields, and its own optional per-row preview), or
  paste a list of URLs (one per line) into a textarea and add them all as rows in one go. Up to 50
  rows per batch. Rows alternate background shading so it's easy to tell where one ends and the
  next begins when scanning a long list. "Skip duplicates" avoids re-queuing a URL already in the
  library.
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
- **Grid** — a flat, filterable grid of every item, with server-side pagination available
  (Settings → toggle it on and pick a page size) for large libraries.
- **Folders** — browse by collection, one level at a time, with a breadcrumb trail and
  browser-back support for navigating up.

**Toolbar**: full-text search (title/uploader/artist/description, backed by SQLite FTS5), a sort
key (date downloaded, title, filename, year, duration, sequence #) + ascending/descending toggle
(also remembered server-side), a collection filter (Grid view only), and a year filter.

**Multi-select**: check items (Grid or Folder view) to bulk-assign tags or bulk-delete a whole
selection at once, instead of one at a time.

**Per-item actions** (the "⋮" menu on each card), in order:
- **Edit** — title, filename (renames the file on disk), uploader, duration, resolution, artist,
  year, season #, sequence #, description, tags, and the original source URL are all editable.
  Editing title/artist/year/season #/sequence # also re-embeds those tags into the actual media
  file's container metadata in the background (an `ffmpeg -c copy` remux) — the Save action itself
  returns immediately rather than waiting for that to finish.
- **Move** — relocate the file to a different collection and/or folder.
- **Copy URL** — copies the item's original source URL to the clipboard (disabled if it has none,
  e.g. items imported without a source URL).
- **Compare Metadata** — side-by-side diff of what's currently saved versus what a fresh fetch of
  the source URL would return right now (title, uploader, duration, description, thumbnail,
  resolution) — read-only, changes nothing. Useful for spotting an upstream title/description edit
  before deciding whether to Refresh Metadata.
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
- **NFO** submenu (when Generate NFO is enabled on the item) — generate/regenerate, view the raw
  XML, or delete just the sidecar file (leaves the toggle itself alone, so it's rewritten again on
  the next relevant edit).
- **Delete** — "Remove from library" deletes only the database entry (file stays on disk);
  "Delete files too" also removes the media file and thumbnail from disk.

An item is blurred (thumbnail obscured until clicked/hovered) if its collection — or any tag
assigned to it — is marked private. See Collections and Tags below.

## Collections

Named presets — a folder under your media root plus a default download type and quality —
selectable from the New Download dialog so you don't have to re-pick them every time.

- Collections nest (sub-collections), shown as a tree; a collection's position in the tree is
  fixed at creation and can't be moved later.
- **Private** — marking a collection private blurs thumbnails for everything in it (and its
  sub-collections) throughout the app, shown with a lock icon in the tree.
- **Season # (optional)** — set once on a collection that holds a single TV-style season of files.
  A new download placed *directly* into that collection defaults its own Season # field to this
  value (not inherited by sub-collections — it's a direct match, not a tree search).
- **Artist (optional)** — set once on a collection dedicated to one artist/creator. A new download
  placed into that collection, or into any sub-collection that doesn't set its own Artist, defaults
  its own Artist field to this value — this one *does* walk up the collection tree, so a layout
  like `Shows/SomeArtist/Season 2/` still resolves the artist from a few levels above.
- **Jellyfin Library ID (optional)** — only shown when Jellyfin integration is enabled in Settings.
  Links this collection to a specific Jellyfin library so "Refresh after download → Specific
  library" (Settings → Jellyfin) knows which one to rescan when something lands here.
- Deleting a collection does not delete the files inside it — downloads/library items just lose
  their collection association.

## Tags

Freeform labels, independent of collections, assignable to any library item (and set up-front on a
new download via the Advanced section, or bulk-assigned to a selection on the Library page).

- Create/rename/delete from the Tags page; usage count shown per tag; deleting one removes it from
  every item that had it (items themselves are untouched).
- **Private** — marking a tag private blurs every item carrying that tag, everywhere it appears,
  the same way a private collection does. This is a second, independent way to mark content
  private that isn't tied to where the file lives on disk — useful when the items you want hidden
  are scattered across several collections rather than confined to one folder.
- Select multiple tags to bulk-delete.

## Artists

A simple named list, assignable to library items and downloads (manually, or auto-filled from a
collection's Artist default — see Collections above).

- Create/rename/delete from the Artists page; usage count shown per artist; deleting one clears it
  from every item that had it (items themselves are untouched, they just lose the artist link).
- Select multiple artists to bulk-delete.

## Import

For files placed directly under your media root from outside the app (e.g. copied in manually,
or downloaded by some other tool) — brings them into the Library without re-downloading anything.

- **Rescan** re-scans the media root for files not already in the Library, showing size, duration,
  resolution, and which collection folder (existing or new) each one would land in.
- Select individual files or **Import All** — each import probes the file with `ffprobe` and
  creates a Library entry for it. You can optionally attach an original source URL per file (so
  Redownload/Refresh Metadata/Compare Metadata work on it later) — imports without one just skip
  those actions. Imported rows are greyed out and can't be re-imported; the scan list itself
  doesn't auto-refresh after every import, only on page load or manual Rescan.
- **Ignored Folders** — mark specific folders (and their sub-folders) to be skipped in future
  scans entirely, e.g. a raw-footage or behind-the-scenes folder you never want surfaced here.

## History

A permanent record of every download attempt — completed, failed, or cancelled — that is never
removed when the corresponding entry is deleted from the Downloads queue.

- Shows title/URL, status, timestamp, and the error message for failures.
- **Retry** re-queues a fresh download for any non-completed entry (failed/cancelled/interrupted),
  reusing the original type/quality/format/collection/filename where the source download record
  still exists.
- **Delete** removes a single entry; **Clear all** wipes every entry immediately regardless of the
  retention setting below.
- Entries older than the "Keep history for" window (Settings → History; default forever) are
  pruned automatically.
- If "Anonymize History Links" is on (Settings → Privacy), URLs here are shown as a short
  deterministic hash instead of the real link — the same URL always hashes to the same value, but
  the underlying link isn't exposed. Retry still works either way.

## Logs

A debugging view over every download's captured yt-dlp invocation — the exact command that ran,
its exit code, and the last ~8000 characters of its stdout/stderr — for both successful and
failed downloads. Shares the same underlying rows (and the same retention setting, "Keep download
log for" in Settings → Downloads) as the Downloads queue's own history, just presented for
debugging rather than as a live control panel.

- Free-text search matches against title/URL and the captured command; a status filter narrows
  the list to one download status.
- **View log** opens the full detail for a row: command, exit code, and the stdout/stderr tails
  in scrollable monospace blocks, each with its own copy-to-clipboard button. The button is
  disabled (with a tooltip) for rows that never got far enough to invoke yt-dlp at all (e.g. a
  still-queued download).
- Retry count is shown when a download needed more than one attempt.
- Respects the same "Anonymize History Links" setting as History (Settings → Privacy) — URLs are
  hashed the same way when that's enabled.

## Backup

Export/import settings and library data as portable JSON files — for moving to a new install,
or just as a safety net.

- **Settings** card — exports every setting to one file; importing overwrites your current
  settings with the file's values (never deletes a setting the file doesn't mention).
- **Library Data** card — exports collections, tags, artists, and every library item that has a
  saved source URL. **No media files are included** — it's a recipe, not an archive. Importing
  creates any missing collections/tags/artists (matched by name/path, never overwriting existing
  ones) and re-queues a fresh download for every item in the file, deduplicated against what's
  already in the library. Tags on redownloaded items aren't automatically reapplied — retag them
  once the redownload finishes.
- Both exports can optionally be **encrypted with a password** — the exported file is unreadable
  without it, and importing an encrypted file prompts for the same password.

## Settings

Two columns: **App Settings** (General, Account, yt-dlp, Appearance) on the left, **Content
Settings** (Downloads, Privacy, History, Thumbnails, Player, Jellyfin) on the right.

- **General** — max concurrent downloads (applies to the live worker pool immediately, no
  restart needed) and a download timeout in minutes (kills and marks failed any download still
  running past the limit; 0 = no limit). Download directory is shown but not editable here (set
  via the `MEDIA_ROOT` environment variable).
- **Account** — change your password (requires the current one).
- **yt-dlp** — shows the installed version and whether a newer one is available on PyPI; one-click
  update.
- **Appearance** — light / dark / system theme.
- **Downloads** — default download type and quality for new downloads; "I trust this source" (skip
  the New Download preview fetch and queue immediately); how long to keep the download log
  (Downloads/Logs pages) before automatic pruning, plus a "Clear all now" button.
- **Privacy** — how strongly private-collection/private-tag thumbnails are blurred (weak / default
  / strong) until clicked to reveal.
- **History** — "Anonymize History Links" toggle (see History above); how long to keep history
  entries before automatic pruning, plus a "Clear all now" button.
- **Thumbnails** — how many candidate frames "Choose from Video" offers (2/4/6/8).
- **Player** — autoplay on opening a library item (including a private one, right after you reveal
  it); playback volume is remembered automatically between plays.
- **Jellyfin** — enable/disable the integration, server URL + API key, and what happens after a
  download completes: nothing, rescan the entire library, or rescan only the specific Jellyfin
  library linked to the download's collection (set per-collection in Collections → Edit). A burst
  of downloads within a short window is coalesced into a single rescan rather than one per file.
  "Rescan Library Now" triggers one manually at any time.

Every card here saves immediately on change — there's no separate "Save" step, except General,
Downloads' type/quality pair, and Jellyfin, which each batch their fields behind one Save button.
