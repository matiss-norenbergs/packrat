# Features

A guide to every page in Packrat and how it works. For the underlying architecture (backend
package layout, data flow, deliberate scope cuts), see [`architecture.md`](architecture.md); for
the raw REST surface, see [`api.md`](api.md).

Packrat requires signing in — the first time you open it, a one-time setup wizard creates the
single admin account (there's no multi-user support). See "Auth and CSRF" in
[`architecture.md`](architecture.md) for the session/CSRF mechanics.

## Browse

A Netflix-style homepage for your library, distinct from the Library page's flat grid/folder
browsing below — a hero banner plus horizontally-scrolling rows: **Continue Watching** (videos
with saved playback progress — see the Library player below), **Recently Added**, and rows grouped
by show/collection and by artist. Meant for casual "what do I watch next" browsing rather than
searching/filtering, which is what the Library page is for.

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
  - Video, audio, or **Image**, quality/format, and an optional filename override (defaults to the
    source's title). Image is for a direct link to a single image file — no `yt-dlp` involved, no
    gallery/multi-image support (a real gallery-site integration is a possible future addition, not
    this). The image is re-encoded per Settings → Library → "Image conversion format" (default
    JPEG) and doubles as its own thumbnail.
  - A live preview card (thumbnail/title/uploader/duration for video/audio; the image itself for
    Image) fetches before you submit, unless "I trust this source" is enabled in Settings →
    Downloads. If the URL matches something already in the library, a duplicate warning is shown
    but doesn't block submission. Every preview image request — the Image type's own preview and
    the yt-dlp-reported video/audio thumbnail alike — is proxied through the backend rather than
    fetched directly by the browser, so it honors a configured proxy (see Settings → yt-dlp below)
    the same way the real download does.
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

**Multi-select** (Grid or Folder view): check items, then use the **Bulk operations** menu to apply
an action to the whole selection at once — Edit fields, Assign tags, Set artist, Set year, Generate
NFO, Edit sequence, add to the [compare list](#compare-list), Download file(s) (re-queues each
selected item's own source URL — items with none are silently skipped), a Thumbnail submenu
(Download thumbnail(s), [frame-matching](#frame-matching), sharpening — see AI Enhancement),
Delete file (removes just the media file for every selected item, keeping the entries as
placeholders — see Ghost items below), or Delete selected (remove the items entirely, optionally
deleting their files).

**Per-item actions** (the "⋮" menu on each card), in order:
- **Edit** — title, filename (renames the file on disk), uploader, duration, resolution, artist,
  year, season #, sequence #, description, tags, and the original source URL are all editable.
  Editing title/artist/year/season #/sequence # also re-embeds those tags into the actual media
  file's container metadata in the background (an `ffmpeg -c copy` remux) — the Save action itself
  returns immediately rather than waiting for that to finish. A **Rescan** button next to
  Resolution/Duration re-probes the actual file on disk with ffprobe and, if it differs from the
  saved values, offers to pull the probed values into the form — useful after the file was replaced
  outside the app, or to double-check after a Trim.
- **Move** — relocate the file to a different collection and/or folder.
- **Copy URL** — copies the item's original source URL to the clipboard (disabled if it has none,
  e.g. items imported without a source URL).
- **Trim…** — cut a precise portion off the start and/or end of the file. Set Start/End by number
  entry, ±1s/±0.1s/±1-frame nudge buttons, "Use current" (grabs the player's current playback
  time), or "Pick exact frame…" (a grid of every decoded frame in a short window, for
  frame-accurate seeking the browser's own scrubber can't guarantee). "Generate preview" produces a
  trimmed copy without touching the original — toggle Original/Preview to A-B compare, then
  "Accept" (with a confirmation; overwriting the original isn't reversible) or discard the preview.
  Not offered for ghost items.
- **Add to compare list** / **Remove from compare list** — toggles this one item in/out of the
  [compare list](#compare-list); label and icon reflect its current membership.
- **Compare Metadata** — side-by-side diff of what's currently saved versus what a fresh fetch of
  the source URL would return right now (title, uploader, duration, description, thumbnail,
  resolution) — read-only, changes nothing. Useful for spotting an upstream title/description edit
  before deciding whether to Refresh Metadata.
- **Refresh Metadata** — re-fetches title/uploader/duration/resolution/description from the
  original source URL, overwriting any manual edits (with a confirmation, since it's destructive
  to those edits). Never touches the file or thumbnail.
- **Redownload** — re-queues a fresh download using the item's original URL and its original
  type/quality/format if that download record still exists, falling back to app defaults
  otherwise. For a ghost item this is relabeled **"Download now"** — the fill-in action that turns
  a placeholder into a real item.
- **Redownload → From Different URL…** — replaces the file with one fetched from a different link
  entirely (the original source went down, or a re-upload exists elsewhere), rather than the
  item's saved URL. Paste a URL and Fetch to preview it side-by-side against what's currently saved
  (thumbnail, title, uploader, duration, resolution, description), with a duplicate warning if that
  URL already matches another library item. Check which fields to overwrite — Resolution and
  Duration are checked by default, the rest are opt-in. The item's saved source URL always switches
  to the new one regardless of which fields you check.
- **Thumbnail** submenu:
  - **Redownload from URL** — re-fetches the thumbnail image from the source.
  - **Quick Grab** — grabs one random frame from the video file itself.
  - **Choose from Video…** — extracts several candidate frames spread across the video (2/4/6/8,
    configurable in Settings) and lets you pick one.
  - **Match from URL/Current Thumbnail…** — see [Frame Matching](#frame-matching).
  - **Save in Thumbnail Gallery** / **View Gallery…** — see Thumbnail gallery below.
- **NFO** submenu (when Generate NFO is enabled on the item) — generate/regenerate, view the raw
  XML, or delete just the sidecar file (leaves the toggle itself alone, so it's rewritten again on
  the next relevant edit).
- **Delete file…** — removes just the media file from disk (optionally the thumbnail too, via a
  checkbox) to reclaim space, while keeping the library entry — tags, collection membership, and
  all other metadata are untouched. The item becomes a ghost placeholder (see below) until you
  redownload it. Distinct from **Delete**, below, which is permanent.
- **Delete** — "Remove from library" deletes only the database entry (file stays on disk);
  "Delete files too" also removes the media file and thumbnail from disk. Unlike "Delete file…"
  above, there's no entry left to redownload into afterward.

An item is blurred (thumbnail obscured until clicked/hovered) if its collection — or any tag
assigned to it — is marked private. See Collections and Tags below.

### Ghost items

A **ghost item** is a library entry with metadata saved but no file downloaded yet — shown with a
type-appropriate placeholder icon and a "Ghost item" badge instead of a thumbnail. A ghost's
actions menu hides file-dependent actions (Move, Trim, NFO, frame-grab thumbnails, Delete file)
since there's nothing to act on yet.

- **Add item** (Library toolbar) creates one directly: paste a source URL to prefill the title from
  a live preview and optionally fetch the thumbnail up front, or just type a title with no URL for
  a pure placeholder. Collection, artist, year, season/sequence #, tags, and Generate NFO can all
  be set immediately, same as a real item.
- Any real item can become a ghost via **Delete file…** (see above) — frees disk space, keeps the
  catalog entry.
- Settings → Library → **Scan for Missing Files** checks every item's file against disk and
  converts anything gone (deleted, moved, or renamed outside the app) into a ghost automatically.
  Manual only, never runs on a schedule.
- Subscriptions (below) also create ghosts for new uploads when auto-download is off.

### Thumbnail gallery

Every library item can keep a small gallery of saved candidate thumbnail images — separate from
its one *active* thumbnail — so you can stash a few good options and switch between them later
without re-extracting or re-fetching anything.

- **Save in Thumbnail Gallery** (Thumbnail submenu) saves a copy of the current thumbnail as-is;
  "Choose from Video…"'s frame picker and Frame Matching's review screen each have their own save
  icon to stash a specific frame without making it the active thumbnail.
- **View Gallery…** opens a grid of everything saved. Hover a tile for "Set as thumbnail" (applies
  it immediately) or "Remove from gallery"; click to open a fullscreen viewer with next/prev
  arrow-key navigation.
- Removing an image from the gallery never affects the item's current thumbnail, and vice versa.

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

**Cover image (optional)** — pick a custom cover image for a collection, shown instead of the
automatic fallback (the most-recently-downloaded item's thumbnail in that collection's subtree) on
Browse/folder tiles. Choose from an image file already sitting in the collection's own folder on
disk, or upload one directly. Packrat generates its own resized copies rather than serving your
original file — removing the cover reverts the tile to the automatic fallback.

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

**Image gallery (optional)** — build a gallery of images for an artist and pick one as their
display picture (shown wherever the artist is represented, e.g. Browse). Add images from suggested
candidates (thumbnails already used by that artist's own library items) or by uploading directly.
Removing the currently-selected image automatically clears the selection (falls back to an
auto-picked image); removing any other gallery image is unaffected.

## Compare list

A scratch list for lining files up to play back side by side. Add files from the Library page
(select one or more items, or whole collections) via "Add to compare list" — the list persists
server-side across sessions until you remove items or clear it. From the Compare list page, check
up to 6 files and hit **Play selected** to open a synced playback grid: one cell per file, each
with its own native seek bar, plus a bottom bar that can play/pause/set volume across every cell at
once and toggle fullscreen. Two playback options (remembered per-browser): **Preload** buffers
every file aggressively as soon as the page opens rather than waiting for Play, and **Wait for
ready** disables "Play all" until every file has buffered enough to play without stalling.

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
  ones); a **Preview** step shows what's new versus already-in-library before you commit. Choose
  **"Import and download"** to queue a fresh download for every item with a saved URL (items
  without one are always created as [ghosts](#ghost-items)), or **"Import as ghost items"** to
  recreate everything as a placeholder instead of downloading anything. Tags on redownloaded items
  aren't automatically reapplied — retag them once the redownload finishes.
- **Full Backup** card — imports a combined settings + library file in one action (get one from a
  Backup History row's Download button, on this install or another). Same Preview and
  download-vs-ghost-placeholder choice as Library Data, applied to both halves at once. Plain
  Settings-only or Library-only files can also be dropped onto the Settings/Library cards
  respectively — each just extracts its own half.
- Both plain exports can optionally be **encrypted with a password** — the exported file is
  unreadable without it, and importing an encrypted file prompts for the same password.

**Backup History** — Packrat can back itself up automatically: turn on "Auto Backup" (Settings →
Backup) and pick an interval (6h/12h/24h/3 days/weekly) and it periodically writes a full
settings+library snapshot to disk in the background, no action needed. Every attempt — scheduled or
from **"Run Backup Now"** — is logged in a history table (including failures, so it doubles as a
health check), each row showing when it ran, what triggered it, and counts of what it captured.
From a row you can **Download** the file, **Preview** its contents without downloading, or
**Restore** it directly back into this install (same download-vs-ghost-placeholder choice as a
manual import). Old backups are pruned automatically past a configurable retention count (default
14; set to unlimited to keep everything). Scheduled/automatic backups are always unencrypted —
there's nowhere to type a password unattended — use the plain Export cards above if you need a
password-protected file to store off-site.

## Subscriptions

Watches a channel or playlist URL and tells you about new uploads, without you having to check
back manually.

- **Add subscription** — paste a channel/playlist URL; a live preview confirms what it resolves to
  (playlist title/count, or a note if it looks like a single video — still allowed, e.g. a channel
  with one upload so far). Set Type (video/audio), Collection (optional), check frequency
  (1h/6h/12h/24h), Tags, **Auto-download new items** (off by default — off means new uploads become
  library placeholders to review; on means straight to the download queue), and Generate NFO.
  Subscribing baselines every upload that already exists at the URL as "known" — it never queues
  the whole back catalog, only uploads from that point forward.
- The subscriptions table shows known-item count (with a "+N new" badge when there's anything
  unseen), last-checked time (with the error, if the last check failed), auto-download status, and
  an Enabled toggle — disabling only pauses the scheduled checks, "Check now" still works.
- **Known items** (per subscription) is a sortable, paginated table of every upload ever seen,
  most-recently-first-seen first. Select rows (click, shift-click for a range, ctrl/cmd-click to
  toggle, or click-and-drag across rows) and use the toolbar to act on the whole selection at once:
  **Add as ghost** (creates library placeholders for later review), **Queue download** (downloads
  them now), **Mark seen** (dismiss without acting on it — for uploads you don't want), **Link to
  library item…** (single-row only — search-and-pick a library item to manually associate with this
  entry, for when the video was actually downloaded through a different source than this
  subscription tracks, so it was never found automatically), and **Unlink** (clears that
  association). The Status column shows "New" (unseen), "In library" / "In library (ghost)" (linked
  to a library item, automatically or manually — same badge either way), or nothing for a seen entry
  with no link. Re-adding an entry that's already linked prompts for confirmation first rather than
  silently duplicating it, and doesn't overwrite the existing link. An upload that fails to
  auto-download/auto-ghost during a scheduled or "Check now" pass still shows up here (tagged "New",
  no library placeholder) rather than silently vanishing — retry it manually with the same actions.
- **Check now** re-checks immediately instead of waiting for the next scheduled pass; **Edit**
  changes everything except the source URL/Type (changing those is really delete-and-re-add).

## AI Enhancement

Upscales low-resolution library thumbnails by calling a self-hosted Stable Diffusion WebUI
(AUTOMATIC1111-compatible) instance's upscale-only API — nothing leaves your own network. Off by
default; configured entirely in Settings → AI Enhancement (instance URL/credentials, upscaler
model, scaling mode, minimum-dimension threshold below which a thumbnail is considered eligible).

- **Manual runs** — "Enhance Now" processes up to 5 eligible items per click; "Preview Eligible
  Items" lists everything currently under the minimum-dimension threshold (uncapped) with a
  per-row Enhance button to upscale just that one item.
- **Scheduled sweeps** — when "Run automatically every hour" is on, the same eligibility check
  runs alongside the other hourly background sweeps, independent of the manual trigger.
- **Auto-run on new downloads** — when enabled, a freshly-downloaded item's thumbnail is enhanced
  immediately after the download completes (if eligible), without waiting for the next sweep.
  Fresh downloads only, not redownloads.
- **History** — every attempted item (success or failure) is logged with before/after dimensions
  and file size, the failure reason if any, and which of the three triggers above caused it. "Clear
  All History" (Settings → AI Enhancement) wipes the whole log at once.
- **Compare / Revert** — a successful enhancement keeps the pre-enhancement thumbnail as a backup
  (unless "Auto-approve enhanced thumbnails" is on, which skips the backup entirely — no
  Compare/Revert for that item afterward). From the history table's Compare action: "Keep Original"
  reverts to the backup and discards the enhanced version; "Keep Enhanced" keeps the upscaled
  result and frees the backup. Clicking either image opens a fullscreen before/after slider —
  drag the divider to wipe between the two at full resolution.
- **Sharpen** — a separate denoise/detail pass (no resize), distinct from upscaling. Trigger it
  per-item ("Sharpen Thumbnail" in the actions menu) or in bulk ("Sharpen Thumbnail(s)…" from the
  Library toolbar) — shares the same history log and Compare/Revert/Keep-Enhanced/Keep-Original
  mechanics as upscale enhancements.

## Frame Matching

Finds the exact video frame a thumbnail was likely taken from, so a thumbnail that's a degraded,
cropped, or re-encoded copy can be relocated back to the clean, full-quality frame it came from.
This compares images (perceptual hashing across the whole video, refined around the best matches)
— it does not detect duplicate videos.

- **Per-item** (actions menu → Thumbnail → "Match from URL Thumbnail…" / "Match from Current
  Thumbnail…") runs immediately: a dialog shows a spinner while it scans (can take a minute or two
  for longer videos), then a side-by-side compare of the reference image against the found frame,
  with the found frame's timestamp and a confidence score. "Use this frame" sets it as the
  thumbnail right away; the dialog also lets you save it to the item's thumbnail gallery instead of
  committing immediately.
- **Bulk** (Library toolbar → Thumbnail submenu, on a selection) queues every eligible item onto a
  durable, one-at-a-time background queue instead of holding a request open — items with no source
  URL (for "from URL" mode), no current thumbnail (for "from current" mode), or no downloaded file
  (ghost items) are silently skipped, and an item already in the queue isn't re-queued.
- The **Frame Matching** page (sidebar) is where bulk-queued matches get reviewed — a working
  queue, not a permanent history: select a finished row and **Review** to see the side-by-side
  compare, then **Use this frame** (applies it and removes the row) or **Discard**. Rows still
  running or errored can also be discarded/dismissed directly from the table. Live state changes
  stream in over WebSocket rather than polling.
- Confidence scores are shown even when low — a correct match can still score in the 70s–80s, so a
  low score is a hint to look closely, not a sign the match is wrong.

## Settings

Two columns: **App Settings** (General, Account, yt-dlp, Appearance) on the left, **Content
Settings** (Downloads, Privacy, History, Thumbnails, Player, Jellyfin) on the right.

- **General** — max concurrent downloads (applies to the live worker pool immediately, no
  restart needed) and a download timeout in minutes (kills and marks failed any download still
  running past the limit; 0 = no limit). Download directory is shown but not editable here (set
  via the `MEDIA_ROOT` environment variable).
- **Account** — change your password (requires the current one).
- **yt-dlp** — shows the installed version and whether a newer one is available on PyPI; one-click
  update. Also where the cookies browser/profile, proxy, and rate-limit are set. The proxy
  (`socks5://`/`http://`/`https://`) is used by `yt-dlp` itself and by every image download/preview
  fetch (see Downloads above) — a sidebar dot next to **Downloads** shows its live state at a
  glance: grey (not set), green (reachable), red (configured but not reachable).
- **Appearance** — light / dark / system theme, plus a primary color (Default/Blue/Red/Green/Violet)
  applied to buttons, badges, switches, and other primary-colored UI app-wide. Both are browser-local
  preferences — no backend round-trip, same as any other client-only setting.
- **Downloads** — default download type and quality for new downloads; "I trust this source" (skip
  the New Download preview fetch and queue immediately); how long to keep the download log
  (Downloads/Logs pages) before automatic pruning, plus a "Clear all now" button.
- **Privacy** — how strongly private-collection/private-tag thumbnails are blurred (weak / default
  / strong) until clicked to reveal.
- **History** — "Anonymize History Links" toggle (see History above); how long to keep history
  entries before automatic pruning, plus a "Clear all now" button.
- **Library** — resolution and thumbnail quality tiers (the color-coded low/medium/high thresholds
  shown on library cards); how many candidate frames "Choose from Video" offers (2/4/6/8) and
  whether the medium derivative tier is used; autoplay on opening a library item (including a
  private one, right after you reveal it — playback volume is remembered automatically between
  plays); **Backfill Images** — a one-click background job that generates missing thumbnail/artist
  image/collection-cover derivatives for anything that predates them, and backfills stored
  thumbnail width/height for older items so the "Thumbnail resolution" field is accurate without a
  live image fetch (safe to re-run, a progress readout updates while it's running); **Image
  conversion format** — Original/JPEG/PNG/WebP, what every new `downloadType=image` download gets
  re-encoded to (default JPEG); **Scan for Missing Files** — checks every item's file against disk
  and converts anything gone into a [ghost placeholder](#ghost-items) (manual only, never
  scheduled).
- **Backup** — turn on **Auto Backup** and pick an interval (6h/12h/24h/3 days/weekly) for
  automatic full backups (see Backup above), and how many to keep before old ones are pruned
  (default 14, or unlimited).
- **Jellyfin** — enable/disable the integration, server URL + API key, and what happens after a
  download completes: nothing, rescan the entire library, or rescan only the specific Jellyfin
  library linked to the download's collection (set per-collection in Collections → Edit). A burst
  of downloads within a short window is coalesced into a single rescan rather than one per file.
  "Rescan Library Now" triggers one manually at any time.

Every card here saves immediately on change — there's no separate "Save" step, except General,
Downloads' type/quality pair, and Jellyfin, which each batch their fields behind one Save button.
