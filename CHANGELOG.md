# Changelog

<!--
Maintenance notes:
- Newest entries at the top, oldest at the bottom.
- One dated section per day of work, one bullet per shippable feature or bug fix.
- Skip pure styling/spacing tweaks (margin, width, color-only changes) and
  routine dependency bumps — only record things a user or future contributor
  would actually want to know happened.
- A bullet says what changed and briefly why/what it enables, not an
  implementation play-by-play.
- Date format: YYYY-MM-DD.
-->

## 2026-08-22

- **New: "Image" download type** — the New Download dialog (and Bulk Download, batch, and playlist
  submissions) now accepts a third type alongside Video/Audio: a direct link to a single image
  file. No `yt-dlp` involved (its extractors are built for video-hosting pages, not a bare image
  URL) and deliberately no gallery/multi-image support — one URL, one file, same as any other
  download. The image doubles as its own thumbnail and is re-encoded per a new Settings → Library
  → "Image conversion format" setting (Original/JPEG/PNG/WebP, default JPEG, matching the existing
  video-thumbnail-normalizes-to-JPEG convention). Ghost items and subscriptions intentionally stay
  Video/Audio-only.
- **Image downloads and previews now honor the configured proxy** — the `ytdlp_proxy` setting
  (Settings → yt-dlp → Proxy) already routed `yt-dlp` itself; it now also routes the new Image
  download type's fetch, and — for every download type — the New Download dialog's live preview
  thumbnail, which used to be a raw client-side `<img>` request straight to the external URL with
  no way to respect a backend-configured proxy. A new sidebar status dot next to **Downloads**
  shows the proxy's live state at a glance (grey = not configured, green = reachable, red =
  configured but not reachable).
- **Fix: subscription-triggered audio downloads failing with "invalid audio format"** — downloads
  queued from a subscription (automatic checks, or the "Known items" dialog's "Queue download"
  action) never set an audio format, unlike every other download path, which defaults to `mp3` when
  one isn't specified. `yt-dlp` was getting handed `--audio-format ""` and rejecting it outright.
  Subscriptions now apply the same `mp3` default; the yt-dlp arg-building step also got a defensive
  fallback so no future caller can reproduce this by forgetting to set one.

## 2026-08-20

- **Library Details mode: Gallery field + Thumbnail resolution fix** — the
  Details-mode field list on library cards now shows a "Gallery" row with the
  item's saved gallery image count (computed server-side via a single batched
  query per page, no extra per-item requests). When an item has no saved
  gallery images, video items show "0" and everything else (audio, unknown
  media type) shows "-". Also fixed "Thumbnail resolution" on the same card:
  it now reports the *original* sidecar thumbnail's true pixel dimensions
  (previously it read whatever derivative the `<img>` happened to point at —
  first the full-size original via an extra client-side image load, then
  briefly the downscaled medium tier). Dimensions are now probed once
  server-side (header-only, no full decode) whenever a thumbnail is written —
  set, redownloaded, imported, enhanced, etc. — and persisted on the library
  row, so the card just reads two numbers off the API response with zero
  extra image fetches. Existing items get backfilled via the Settings →
  Library → "Backfill Images" tool. The stored dimensions are intentionally
  left out of library backups/exports, since they're a disposable derived
  value that gets regenerated the next time the thumbnail changes.

## 2026-08-18

- **Thumbnail Gallery: save from Frame Matching and AI Enhancement compare views** —
  both images in the Frame Matching result (Reference / Frame at timestamp) and both
  images in the AI Enhancement compare dialog (Original / Enhanced) now have a
  floating "Save to gallery" icon, matching the one already on "Choose from Video"
  frames. Fixed a side effect: these dialogs' first focusable element used to grab
  the initial focus, which silently popped its tooltip open on load — the dialogs
  now start with no auto-focused element, like other list/grid dialogs in the app.

## 2026-08-17

- **New: Thumbnail Gallery** — save frames/images for a library item without
  making them the active thumbnail. Library item → Thumbnail → "Save in
  Thumbnail Gallery" saves a copy of the item's current active thumbnail
  straight to the gallery (works for ghost items too, as long as they have
  a fetched thumbnail); "View Gallery…" opens a
  dialog listing everything saved, each tile with floating "set as
  thumbnail" and delete icons on hover. Clicking a tile opens a fullscreen
  carousel viewer for a closer look, with arrow-key/on-screen navigation
  between saved images and the same set/delete actions available from
  there. The "Choose from Video" picker also changed: clicking a frame now
  just selects it (highlighted ring) instead of applying it immediately —
  a footer "Select" button, disabled until you've picked one, is what
  actually confirms — and each frame now has a floating save icon that
  sends it to the gallery independently of selecting it. Saved images and
  their DB rows cascade-delete with their library item.
- **New: separate resolution tiers for thumbnails** — the Library page's
  "Thumbnail resolution" field (Details mode) is now colored by its own
  low/medium/high tier, independent from the existing video Resolution
  tier. Configurable in Settings → Library → Thumbnails, with its own
  medium-tier toggle and quality-tier slider, defaulting to a lower
  480p/1080p split (vs. the video tier's 720p/2160p) since a thumbnail is a
  small preview image that rarely exceeds 1080p. The same tier now also
  colors the resolution text shown in the Frame Matching compare view and
  the AI Enhancement/Sharpen Compare dialog, so it's easy to spot at a
  glance whether a candidate frame or enhanced thumbnail is actually higher
  resolution than what it's replacing.
- **Library: brighter, duotone selection checkboxes** — the hover/select
  checkbox on Library grid cards, folder-view collection tiles, and Compare
  List tiles now renders with a white ring plus a dark outer shadow instead
  of the default single-color border, so it stays visible regardless of
  what's underneath it (thumbnails vary too widely in brightness for a flat
  border to reliably show up).
- **Library: Details mode no longer blocks selection/bulk operations** —
  the Library toolbar's "Add item"/"Bulk operations" controls and every
  view's (Grid, List, Folders) selection checkboxes and per-item action
  menus now render regardless of Manage vs. Details mode. Details mode is
  now purely additive (extra info panel/row on cards), matching how the
  rest of the app already expected it to behave.
- **Library toolbar: single-row layout** — "Add item"/"Bulk operations"
  moved onto the same row as Search/Filters & Sort/the privacy eye/Settings
  icons (previously two rows), with Filters & Sort placed directly before
  Search and a vertical divider separating the search/filter controls from
  the display-setting icons. The bulk-operations menu also gained a
  "Thumbnail" submenu grouping "Download thumbnail(s)…", "Match from
  URL/current thumbnail…", and "Sharpen thumbnail(s)…" instead of listing
  them flat.

## 2026-08-16

- **New: "Sharpen Thumbnail" AI Enhancement mode** — a manual-only
  denoise/detail pass for the Stable Diffusion WebUI integration that
  improves a thumbnail's quality without resizing it (unlike the existing
  "Upscale" mode). Reachable from the Library toolbar's bulk operations
  menu ("Sharpen thumbnail(s)…") and from an item's Thumbnail submenu
  ("Sharpen Thumbnail…"); both only appear when AI Enhancement is enabled
  in Settings. Ignores the usual minimum-dimension eligibility gate (the
  point is to sharpen thumbnails that are already a decent size) and is
  never run by the scheduled sweep or auto-on-download. The AI Enhancement
  page's history table gains a "Type" column and filter (Upscale/Sharpen)
  to distinguish the two.
- **New: Bulk frame matching + "Frame Matching" page** — the Library
  toolbar's bulk operations menu gains "Match from URL Thumbnail…" and
  "Match from Current Thumbnail…", queuing frame matching for every eligible
  selected item (skipping ghosts and items missing what the mode needs) and
  processing them one at a time in the background. A new "Frame Matching"
  nav page shows the queue as a table — item, mode, and live state (queued,
  running, done with a confidence score, or error with a hover-for-details
  badge) — with checkbox multi-select, pagination, and a toolbar (Review,
  Discard). Review opens the same side-by-side compare view as the
  single-item dialog, backed by both images persisted to disk at match time
  rather than re-fetched later. Progress streams over WebSocket, so the page
  updates live with no polling. It's a working queue, not a history:
  accepting, discarding, or dismissing an item removes it from the list.
- **Frame Matching: skip items already in the queue** — both the bulk
  "Match from URL/Current Thumbnail…" action and the single-item dialog
  (from a library item's Thumbnail menu) now check for an existing queue row
  (any state) for that item before starting a new scan, since matching is
  CPU-heavy and re-running it on something already pending or awaiting
  review is wasted work. The bulk dialog excludes already-queued items from
  its preview count up front; the toast after queuing breaks out how many
  were skipped for being ineligible vs. already queued. The single-item
  dialog surfaces a clear inline error (and a toast) instead of silently
  kicking off a redundant scan.

## 2026-08-15

- **New: Frame matching for thumbnails** — under a library item's Thumbnail
  menu, two new actions ("Match from URL Thumbnail…" and "Match from
  Current Thumbnail…") scan the video itself to find the frame the
  thumbnail was likely taken from. A coarse 1fps sweep of the whole video
  narrows down candidates by perceptual hash, then a fine pass re-extracts
  frames around the best matches to pinpoint the closest one. The result
  dialog shows both images side by side with a confidence score, and
  clicking either opens the same fullscreen compare slider used in AI
  Enhancement to eyeball the match before committing. "Match from URL"
  re-fetches the source thumbnail fresh (bypassing yt-dlp's thumbnail
  conversion step) rather than relying on the possibly-broken stored copy —
  useful for recovering from AVIF thumbnail download failures. "Match from
  Current" compares against whatever thumbnail is currently set, including
  an AI-enhanced one.
- **New: AI Enhancement page bulk actions** — a "more actions" menu next to
  Delete adds three bulk operations for the selected history rows: Keep
  Enhanced (permanently commits to the enhanced thumbnail and discards the
  stored original, for every selected item that hasn't been reviewed yet),
  Keep Original (same eligibility, but discards the enhancement instead),
  and Redownload Original (re-fetches each selected item's thumbnail from
  its saved source URL, silently skipping any item with none saved).
  Selections are deduped by library item first, since one item can have
  multiple history rows.
- **Collections page reworked to match Tags/Artists** — replaced the old
  plain tree with a toolbar (New/Edit/Delete/Expand-Collapse/Search),
  tree-aware pagination (top-level collections are paged 25 at a time, each
  page showing full sub-trees rather than splitting a parent from its
  children), and a sticky header/toolbar/footer layout so controls stay on
  screen while the list scrolls. The expand/collapse-all state is now
  remembered across reloads, and the pagination footer shows both the
  top-level and total collection counts.
- **New: Collection details side panel** — selecting a collection shows its
  cover art and full metadata (path, folder, type, quality, privacy,
  sequence range, gaps, item counts, etc.) in a collapsible right-side
  panel, mirroring the Artists page's image panel. Every field renders even
  when empty (dash fallback), and Private/"Show as single item in Browse"
  are shown as colored Yes/No badges. The panel's open/collapsed state is
  remembered across reloads independently of the expand/collapse toggle.
- **Collection row selection** — clicking a row selects it (ctrl/cmd-click
  toggles it in or out of the selection), matching the click-to-select
  convention used elsewhere in the app; the per-row details popover now
  opens on hover instead of requiring a click.
- **Fixed: per-row "Add sub-collection"/Edit dialogs not registering
  clicks** — selecting a row could swallow mousedown events from inside
  those dialogs' portaled content, breaking focus and typing in their
  fields. Row selection now only intercepts clicks that land on the row's
  own DOM, not on dialogs it renders as children.
- **History, Logs, and Subscriptions pages reworked to match Tags** — all
  three switched to the shared multi-select Table pattern (drag-select,
  shift/ctrl-click, header select-all, right-click context menu), debounced
  search, and paginated sticky-header layout. History gained working bulk
  Retry and bulk Delete; Subscriptions gained bulk Delete and bulk Check
  now (each fires the existing single-item endpoint once per selected
  subscription and reports one aggregate "Found N new item(s)" toast, since
  no bulk backend route exists for either page). Logs intentionally has no
  selection column — there's no delete capability for logs at all.
- **Downloads page gained multi-select, bulk Delete, search, and
  pagination** — kept its existing card layout (not converted to a table)
  but added the same drag-select, shift/ctrl-click, right-click context
  menu, debounced search, and sticky header/toolbar/pagination-footer
  conventions as Tags/Collections, plus a checkbox per item. The per-item
  Delete button was removed in favor of a single toolbar/context-menu
  Delete that acts on the whole selection; still-active (in-progress)
  downloads in a selection are skipped since the backend refuses to delete
  those until cancelled. The per-item Cancel button for in-progress
  downloads is unchanged. New Download and Bulk Download are now a single
  grouped control on the toolbar's left side (Bulk Download collapsed to
  an icon with a tooltip) instead of two separate buttons in the page
  header.

## 2026-08-14

- **Artists page reworked to match Tags** — replaced the old plain list with
  the same table experience the Tags page already had: instant client-side
  search, numbered pagination, full row selection (click, ctrl/cmd-click,
  shift-click range, and click-drag), and a right-click context menu for
  New/Edit/Delete. Also added a Birthday column (with computed age).
- **New: Artist Images side panel** — selecting a single artist on the
  Artists page now shows its current image plus every other uploaded or
  downloaded image in a collapsible right-side panel, instead of only being
  visible from inside the Edit dialog. The panel's collapsed/expanded state
  is remembered across reloads, and its images aren't fetched in the
  background while it's collapsed.

## 2026-08-13

- **Fixed: Backup import's "download" mode ignored ghost items that had a
  saved URL** — a ghost placeholder with a source URL is just as
  downloadable as any other item, but download mode previously left it as a
  ghost regardless of the mode picked; it's now correctly resolved into a
  real queued download, matching what the mode's own description already
  promised. The import confirmation dialogs' copy was corrected to describe
  this accurately too.

## 2026-08-12

- **Backup: every library item is now included, not just ones with a saved
  URL** — a locally-imported file with no source URL (e.g. via File Import)
  used to be silently dropped from both ad-hoc library exports and full
  (Run Backup Now / scheduled) backups. It's now always exported, and round-
  trips as a ghost placeholder on import since there's nothing to
  redownload it from.
- **Backup import: choose "download" vs "ghost placeholders only"** — both
  the Library Data import card and the new full-backup Restore action now
  have a mode selector. "Ghost placeholders only" recreates every item as a
  metadata-only placeholder instead of queuing any redownloads — useful for
  restoring onto a fresh install before you're ready to redownload
  everything, or intentionally deferring it.
- **New: Restore action for full (Run Backup Now / scheduled) backups** —
  previously, a full backup listed in Backup History could only be
  previewed (read-only) or downloaded; there was no way to actually apply
  it back, since the existing Import Settings/Import Library flows only
  ever accepted their own single-purpose file kind. A new Restore button on
  each history row applies both the settings and library halves in one
  action.
- **New: Full Backup card for importing an ad-hoc full backup file** — a
  full backup previously could only be restored via a Backup History row on
  the same install that created it. A new Full Backup card on the Backup
  page accepts any full backup file (downloaded from this or another
  install) and applies both halves in one action, with a Preview step
  first. The existing Settings and Library cards now also accept a full
  backup file for their import, extracting and applying only their own
  section — so a single full backup file works with whichever card matches
  what you want to restore. The download-vs-ghost-only mode picker moved
  out of the page body and into the confirmation dialogs (the direct-import
  prompt and the preview dialog's "Import Now" step) across all three
  cards, so it reads as part of committing to the import rather than a
  standing setting. Also fixes two bugs in the import preview surfaced
  while building this: a crash when a library had zero tags/collections/
  artists (the backend sends `null`, not `[]`, for an empty list), and a
  "will be queued" count that could go negative when an item was both a
  ghost and already a duplicate.

## 2026-08-09

- **AI Enhancement history: bulk delete + numbered pagination** — the
  per-row delete button is gone; each row now has a checkbox (plus a
  header "select all"), and a "Delete Selected" button in the toolbar
  removes every checked row in one request. The pagination footer now
  shows numbered page buttons (with an ellipsis for long histories)
  instead of just "Page X of Y", so jumping to a specific page no longer
  requires clicking Next repeatedly.
- **Fix: AI Enhancement history's Compare icon appeared on every row for an
  item enhanced more than once** — an item re-enhanced without an
  in-between revert got a Compare/Revert action on *every* success row,
  even though they all shared the same original-thumbnail backup and only
  the most recent row's output was actually still live. Now only the
  single latest successful row per item shows it. Also, a reverted row's
  status column now shows just "Reverted" instead of "Success" and
  "Reverted" side by side.
- **Fix: redownloading/quick-grabbing/hand-picking a thumbnail no longer
  leaves a stale AI-enhancement backup behind** — previously, replacing an
  enhanced item's thumbnail via "Redownload thumbnail," "Quick Grab," or
  "Choose from Video" (and a full item redownload that swaps the
  thumbnail) left the old pre-enhancement backup and its Compare/Revert
  entry pointing at an image with no relation to the new thumbnail;
  clicking "Revert to Original" afterward would silently overwrite the new
  thumbnail with that stale backup. All four paths now clear the backup
  as part of the thumbnail swap.
- **AI thumbnail enhancement: live progress, failure cooldown, bulk-select,
  and searchable/paginated history** — "Enhance Now" and the eligible-items
  dialog's bulk action now return immediately and stream per-item status
  live over WebSocket, so the AI Enhancement page shows "Enhancing:
  `<title>`" in real time instead of the page blocking until a whole batch
  finishes (closing the tab mid-run no longer cancels it either, since the
  run is detached from the request). An item that just failed is skipped by
  the scheduled sweep and "Enhance Now" for an hour, but still shows up
  (with a "Recently failed" badge) in the eligible-items dialog for a
  deliberate manual retry. That dialog is now a wider table — Item / Artist
  / Collection / Dimensions / Status — with checkboxes and a single toolbar
  "Enhance Selected" button, replacing the old one-button-per-row list. The
  history table gained a search box plus Status/Trigger filters and
  Previous/Next pagination, now that it's fetched a page at a time from the
  backend instead of all at once.
- **AI thumbnail enhancement: configurable batch size, per-item loading
  state** — the "max items per batch run" cap (previously a fixed 5) is now
  a Settings → AI Enhancement field, applying to both the hourly scheduled
  sweep and manual "Enhance Now" clicks. The "Preview Eligible Items"
  dialog's per-row Enhance button no longer disables every other row while
  one item is enhancing — each row now tracks its own loading state
  independently, so unrelated items stay clickable.

## 2026-08-08

- **AI thumbnail enhancement: fullscreen before/after compare slider** —
  clicking either image in the Compare dialog now opens a fullscreen,
  backdrop-less overlay with the original and enhanced thumbnails stacked
  exactly on top of each other; drag the center divider left/right to wipe
  between them.
- **AI thumbnail enhancement: clear-all history, auto-approve, and
  auto-run-on-download** — a "Clear All History" button on the Settings tab
  wipes the entire AI Enhancement log (and frees every stored original
  backup along with it, same as a manual per-item delete but at full
  scope). Two new opt-in settings: "Auto-approve enhanced thumbnails"
  skips saving the pre-enhancement backup entirely (no Compare/Revert
  afterward, applies to every trigger); "Enhance new downloads
  automatically" enhances a fresh download's thumbnail right after it
  completes, without waiting for the hourly sweep, if it's still under the
  configured minimum dimension. The history table gained a "Trigger"
  column (Manual/Scheduled/Auto). Every enhancement attempt, regardless of
  what triggered it, is now serialized behind a lock with a re-check right
  before upscaling, closing a race where two triggers landing on the same
  item back-to-back could double-upscale it.
- **New: AI thumbnail enhancement** — opt-in (off by default) upscaling of
  low-resolution library thumbnails via a self-hosted Stable Diffusion
  WebUI (AUTOMATIC1111-compatible) instance's upscale-only API. Configure
  the instance URL/credentials and a minimum-dimension threshold in
  Settings → AI Enhancement; a new dedicated AI Enhancement page runs
  enhancements on demand (also swept hourly alongside the other background
  checks) and shows a history of every attempted item — before/after
  dimensions and file size, and the failure reason for anything that
  didn't go through.
- **AI thumbnail enhancement: model picker, preset dimensions, status
  badge, and nav gating** — the Settings tab's upscaler field can now
  query the configured instance's actual available models ("Load models")
  instead of requiring the exact name typed by hand, with a "Custom…"
  fallback for anything not in the list; minimum dimension gets the same
  treatment (a handful of common presets plus a free-entry custom option).
  The AI Enhancement page now shows a live status badge (Active / Not
  reachable / Not configured) next to its title, and both the page and its
  sidebar link are hidden while the feature is disabled instead of just
  showing an inert "Enhance now" button.
- **AI thumbnail enhancement: scale to a target size, not just a fixed
  factor** — Settings → AI Enhancement now has a "Scaling" choice: "Multiply
  by a factor" (the original behavior, still 4x by default) or "Scale to a
  target size" (e.g. 1920 for 1080p on a 16:9 thumbnail), which computes a
  per-image multiplier so every enhanced thumbnail lands at the same
  longest-side pixel count regardless of how small the original was.
- **AI thumbnail enhancement: schedule toggle + preview eligible items** —
  the hourly automatic sweep can now be turned off independently of the
  feature itself ("Run automatically every hour" in Settings), so it can be
  used purely on-demand via manual "Enhance Now" clicks. The AI Enhancement
  page also gained a "Preview Eligible Items" button showing every item
  currently below the configured minimum dimension, since only the first 5
  are processed per run and a larger backlog previously had no way to be
  inspected ahead of time.
- **AI thumbnail enhancement: per-item trigger + before/after compare with
  revert** — the "Preview Eligible Items" dialog now has an "Enhance"
  button on each row to upscale just that one item, bypassing the 5-item
  batch cap. Every successful enhancement also backs up the pre-enhancement
  thumbnail (the first time an item is enhanced only, so re-enhancing never
  overwrites the true original); history rows for an item with a backup get
  a "Compare" action showing both images side by side, with the option to
  revert to the original (discarding the enhanced result) or delete the
  stored original outright (keeping the enhancement, freeing the backup).
- **AI thumbnail enhancement: delete history entries** — the history table
  now has a delete action per row. If the row being deleted is the last one
  left for its item and that item still has a stored original, deleting it
  also frees that original (equivalent to "Delete Original") — since
  Compare is only reachable from a history row, clearing the last one would
  otherwise leave an orphaned, unreachable backup on disk. Deleting any
  other row leaves the item's backup untouched.
- **AI thumbnail enhancement: history retention setting** — Settings → AI
  Enhancement gained a "Keep history for" option (7/30/90/365 days or
  forever, default forever), mirroring the existing History/Backup
  retention settings. The hourly sweep now also prunes old AI Enhancement
  history rows, cascading into the same last-row backup cleanup a manual
  delete does.
- **AI thumbnail enhancement: bigger Compare dialog + clearer action
  names** — the before/after Compare dialog now uses most of the viewport
  instead of a fixed max-width, so both thumbnails render larger. Its two
  actions are renamed for clarity: "Keep Enhanced" (was "Delete Original")
  keeps the AI-upscaled result permanently and frees the stored backup;
  "Keep Original" (was "Revert to Original") discards the enhancement and
  restores the pre-enhancement thumbnail.
- **AI thumbnail enhancement: "Reverted" badge on history rows** —
  choosing "Keep Original" no longer leaves history rows silently
  describing a thumbnail that isn't live anymore. Rows undone by that
  revert now show a "Reverted" badge (hover for when), while their
  before/after numbers stay exactly as recorded — an accurate log of what
  that run produced, not a claim about the item's current thumbnail. A
  later re-enhancement starts a fresh, unmarked row.

## 2026-08-07

- **Fixed: a successful download could still end up missing from the
  library** — `--write-thumbnail`/`--convert-thumbnails jpg` runs as a
  postprocessing step inside the same yt-dlp invocation as the video
  download; if that conversion fails (e.g. an AVIF thumbnail on a minimal
  ffmpeg build with no AVIF decoder — the Docker image's Alpine `ffmpeg`
  package is exactly this case), yt-dlp exits non-zero even though the
  video itself downloaded and moved into place fine. The queue treated any
  non-zero exit as a hard failure, discarding the already-successful
  download and never creating the library item — recoverable only by
  manually re-adding the file via File Import. Now a non-zero exit is only
  fatal if the video file genuinely isn't on disk; if it is, the item is
  still created (falling back to no thumbnail rather than pointing at a
  `.jpg` that was never produced), and the leftover unconverted thumbnail
  file yt-dlp left behind is cleaned up instead of sitting in the media
  folder unused forever.
- **New: subscription check-failure warning + "New"/mark-as-seen for Known
  items** — a subscription whose URL starts failing (dead/private video,
  network error) now shows an amber warning icon next to "Last checked,"
  with the actual error on hover, instead of failing silently in the
  server log. Separately, every entry in the Known Items dialog now tracks
  whether it's been seen: unseen entries get a "New" badge (and a "+N new"
  count on the Subscriptions table) plus a "Mark seen" button to dismiss
  them; adding an entry as a ghost or download also marks it seen
  automatically, since acting on it is proof enough you've noticed it.
  Existing entries were backfilled as seen so this doesn't flood
  already-known videos with "New" badges on first load.
- **New: subscriptions "Known items" dialog** — browse every video a
  subscription has ever seen (not just the ones that became ghosts or
  downloads) and manually add any of them to the library as a ghost item
  or a queued download, per-row. Mainly useful for a video that was
  recorded during a subscription's baseline fetch — which deliberately
  doesn't create anything — but that you've since decided you do want
  after all.
- **New: channel/playlist subscriptions** — save a channel or playlist URL
  once and Packrat periodically re-checks it for new uploads (default every
  6h, configurable per subscription), diffing against what it's already
  seen. New uploads either become ghost placeholders to review and
  download manually, or — with "Auto-download" turned on for that
  subscription — go straight into the download queue. Subscribing baselines
  against the channel's current catalog immediately (no ghosts/downloads
  created for existing videos) so only genuinely new uploads trigger
  afterward. New "Subscriptions" page (sidebar, under Backup) lists every
  subscription with its known-item count, last-checked time, a manual
  "Check now," and edit/delete/enable controls.

- **Fixed: downloaded library items stored the wrong resolution/duration**
  — both were taken from yt-dlp's pre-download metadata probe (its
  default/"best" format info), not from the file that was actually
  downloaded, so a lower-quality download could still show up in the
  library tagged with a higher resolution than what's really on disk.
  Fixed by re-probing the actual downloaded file with ffprobe right after
  the download completes, same as `FileSizeBytes` already did.
- **Release pipeline: multi-arch build split into parallel per-platform
  jobs** — the previous single-job `linux/amd64,linux/arm64` build ran the
  emulated arm64 leg sequentially after amd64, slow enough that the
  `v0.1.0` release build got cancelled before ever pushing an image or
  creating the GitHub Release. Each platform now builds on its own runner
  in parallel and pushes by digest; a final job merges the digests into
  one multi-arch manifest and creates the release — same total work, much
  less wall-clock time, and one slow architecture can no longer starve the
  other.
- **New: "Scan for Missing Files" library maintenance action** — checks
  every library item's on-record file against disk and converts any that
  are missing (deleted, moved, or renamed outside Packrat) into ghost
  placeholders, keeping the DB row, tags, and metadata intact so
  "Download now" can fill it back in later. Available from Settings →
  Library; runs on demand only, not on a schedule.
- **New: "Ghost item" banner on library cards** — a small status strip
  ("Ghost item" + icon) floats over the bottom of the thumbnail on every
  card-style surface (Library grid, Compare list, sibling strips), making
  a file-less placeholder item obvious at a glance instead of only being
  distinguishable by its type-icon thumbnail.
- **Fixed: ghost items could still be opened in the player, added to
  Browse rows, or selected onto the compare list** — none of those make
  sense for an item with no file. Ghost items are now excluded from
  Browse's queries and from what a compare-list dialog will add; their
  card's Play button and detail-page links are hidden so navigating to a
  ghost's player page isn't possible from the UI (a direct URL still lands
  on a plain "no file" message instead of a broken player); and a
  compare-list tile whose item later gets ghosted becomes permanently
  unselectable rather than just quietly failing to play.
- **New: "Delete" option for an item's thumbnail** — under the Thumbnail
  submenu, removes just the thumbnail image (raw file and both derivative
  sizes) from disk and falls back to the type-placeholder icon, leaving
  the media file and everything else about the item untouched. Disabled
  when there's no thumbnail to delete.

## 2026-08-06

- **"Choose from Video" thumbnail picker: 12-frame option + batch history**
  — the frame-count setting now goes up to 12 (was capped at 8), and the
  dialog remembers every batch of frames generated this session. A "Frame
  set N" dropdown appears once you've clicked "Get new frames" more than
  once, letting you re-extract and preview any earlier batch without losing
  it — picking from the dropdown never auto-commits, only clicking an
  actual frame does. New batches also never re-pick a timestamp already
  seen this session (within ~1s), and the pick range now spans 5%–100% of
  the video instead of 10%–90%.
- **Configurable max concurrent ffmpeg transcodes** — trim preview generation
  (the only ffmpeg call site that actually re-encodes video, as opposed to
  the cheap stream-copy/single-frame operations) is now gated by its own
  concurrency limit, separate from the download worker count, so mass-firing
  trim previews can't spike CPU unbounded. New "Max Concurrent Transcodes"
  field in Settings → General, next to Max Concurrent Downloads; applies live
  and survives a restart the same way.
- **Self-update checker for Packrat itself** — the sidebar now shows an
  "Update available" indicator (same amber-dot treatment as the existing
  yt-dlp checker) when a newer Packrat release exists on GitHub, linking out
  to the release page. The running version is now embedded at build time
  from the git tag instead of hand-edited, so it stays accurate automatically
  once releases are tagged.
- **Release pipeline**: a new `release.yml` CI workflow builds a multi-arch
  (amd64 + arm64) Docker image and publishes it to GHCR plus a GitHub
  Release whenever a `vX.Y.Z` tag is pushed.
- **CI now builds the Docker image and runs `oxlint`** on every push/PR,
  catching Dockerfile and lint regressions that `go build`/`tsc` alone
  wouldn't.
- **First-run setup screen**: added the legal disclaimer ("Only download
  content you have the right to download.") and a password length hint
  ("Must be at least 8 characters") so the 8-character minimum isn't a
  surprise only discovered after submitting.

## 2026-08-05

- **Ghost items now survive a Backup export/import round trip** — previously
  a placeholder item with no source URL was silently dropped from every
  export (nothing to redownload it from), and one that did have a URL came
  back from an import as a real downloaded item instead of the placeholder
  it actually was. Both are now preserved as ghosts: the export carries a
  status/media-type marker, and importing recreates the ghost row directly
  (tags included) instead of queuing a download for it. Existing backup
  files from before this change still import exactly as they always did —
  the new fields are additive, so their absence just means "not a ghost,"
  the only behavior those files ever had.
- **Library toolbar: "Hide ghost items" filter** — a checkbox in Filters &
  Sort excludes placeholder items from the grid/list/folder views, for
  browsing a library the same way it'll look in Jellyfin (which never sees
  ghosts). Off by default — ghosts still show inline like today unless
  explicitly hidden. Folder/collection ghost counts are unaffected by this
  filter, since they come from a separate endpoint.

## 2026-08-03

- **Bulk "Download file(s)…" and "Download thumbnail(s)…"** — two more
  Library toolbar bulk operations, alongside the existing bulk delete-file:
  the first queues a redownload (same mechanism as the single-item "Download
  now"/"Redownload") from each selected item's saved source URL; the second
  fetches and overwrites each selected item's thumbnail from that same URL,
  independent of whether the item has a file. Both work identically for
  ghost and real items. Items without a source URL never disable the menu
  option itself — they're just excluded from the confirm dialog's affected
  list and left untouched, so a mixed selection doesn't need to be split by
  hand first.
- **Ghost item counts surfaced in the folder view and dashboard chart** — a
  collection tile now reads "7 files (3 ghost)" when it has any placeholder
  items directly in it (Library's folder view and the Collections page's
  tree both show this); the Dashboard's Video vs Audio chart splits each
  bar into a lighter-shade sub-segment for the ghost portion of that media
  type instead of a separate chart, with a matching legend entry and a
  "N ghost items" note under the Library stat card.
- **Ghost (placeholder) library items + delete-file-only** — a new "Add
  item" button on the Library page creates a placeholder entry with no
  downloaded file yet, optionally seeded from a URL (fetches title/metadata
  and, if checked, a thumbnail — never the actual video/audio). Ghost items
  show a type-appropriate icon (film for video, note for audio) everywhere
  a thumbnail would normally appear, and their actions menu hides
  file-dependent actions (Move, Trim, NFO generation, frame-grab
  thumbnails) while relabeling Redownload to "Download now" — the same
  mechanism that fills in the real file once a URL is available, and that
  also grabs a thumbnail automatically if the item didn't already have one
  (a ghost created without "Fetch thumbnail" checked, for example) — yt-dlp
  fetches one on every download regardless, so there's nothing to preserve
  by discarding it. The reverse direction also shipped: an existing item's
  actions menu gained
  "Delete file…", which removes just the media file (optionally the
  thumbnail too) to reclaim disk space while keeping the library entry,
  tags, collection membership, and all other metadata — putting the item
  into the same placeholder state a ghost item starts in. The Library
  toolbar's bulk operations menu also gained a matching "Delete file…" for
  applying this to a whole selection (or an entire selected
  collection/folder) at once — one batched request server-side, same as
  every other bulk action here, not one request per item; items already
  without a file are silently skipped rather than failing the batch.
- **Dashboard: resolution breakdown and storage charts** — a new bar chart
  shows how many library items fall into each standard resolution step
  (480p/720p/1080p/1440p/4K/8K, each item bucketed to its nearest step), and
  a new donut chart shows disk usage for the volume backing the media
  library — Packrat's own usage, other usage on the same disk, and free
  space.

## 2026-08-02

- **yt-dlp venv now installs `curl_cffi` (pinned to `<0.16,>=0.10`)** —
  needed for sites (Dailymotion confirmed; others use the same mechanism)
  whose extractor requires "impersonation" (mimicking a real browser's TLS
  fingerprint) to get past anti-bot checks; downloads from those sites
  previously failed with `The extractor is attempting impersonation, but
  none of these impersonate targets are available`. Pinned below 0.16
  deliberately — yt-dlp's own impersonation module only supports curl_cffi
  0.5.10 or 0.10.x–0.15.x, and silently reports every target as
  "unavailable" (no error) if a newer/unsupported version is installed
  instead, e.g. curl_cffi 0.16.0 itself. Negligible footprint: ~2MB
  prebuilt wheel, inert until an extractor actually needs it.

- **Fixed: trim still producing wildly wrong durations for some MP4 sources**
  (e.g. a 10-minute clip reporting itself as over an hour) even after the two
  fixes below. Root cause: when a trim point isn't already a keyframe, the
  small re-encoded boundary sliver gets muxed at whatever video timescale
  ffmpeg's mp4 muxer defaults to for a fresh encode — which usually differs
  from the original source's own video timescale. Concatenating that sliver
  with the stream-copied remainder (which keeps the source's original
  timescale) forces ffmpeg to rescale between the two, and for B-frame-
  reordered packets specifically, that rescale can silently skip converting
  a timestamp — leaving one packet several times too large and inflating the
  whole file's declared duration by that same multiple, even though the
  actual video content is untouched. Fixed by forcing the re-encoded sliver
  onto the same timescale as the source whenever the output is MP4/MOV.
- **Fixed: trim still producing wrong durations after the 08-01 fix** — the
  previous day's fix (moving `-ss` to an output option) only covered the
  simple case where the trim point already sits on a keyframe. The common
  case — trimming at an arbitrary point, which needs a tiny re-encoded
  sliver joined to the stream-copied remainder — still broke, because
  `ffmpeg`'s `-ss`/`-c copy` combination turned out to be unreliable well
  beyond wrong duration metadata: confirmed by direct reproduction that it
  can silently drop several seconds of content from either end of the kept
  range, or seek to a different timestamp than requested entirely,
  corrupting the join between the re-encoded and copied portions. Fixed by
  no longer pre-cutting the copied portion into its own file at all —
  instead it's referenced directly from the original, untouched source file
  via ffmpeg's concat-demuxer `inpoint`/`outpoint` directives, which was
  confirmed by direct reproduction to always produce exact frame counts and
  correctly continuous timestamps.

## 2026-08-01

- **Redesigned Settings page** — replaced the two-column wall of always-open
  cards with a tabbed layout (General, Account, Downloads, Library, Privacy,
  History, Backup, Jellyfin, yt-dlp, Appearance). Every tab now buffers its
  edits locally and applies them with one Save button, instead of some
  fields saving instantly on change and others requiring a click —
  destructive actions (Clear log, Clear history) and one-off actions
  (Update yt-dlp, Rescan library, Backfill images) stay as their own
  separate buttons, unaffected by Save.
- **Fixed: trim producing wildly wrong durations** — trimming a video (e.g.
  cutting a few seconds off the start) could produce a preview whose reported
  length was several times too long, with laggy/broken playback, even though
  the underlying video content was fine. Root cause: the "smart cut" engine's
  stream-copied middle segment used `-ss` as an ffmpeg *input* option, which
  in combination with `-c copy` writes wrong duration metadata into the
  resulting Matroska/WebM file (confirmed by direct reproduction — the same
  bug independent of Packrat's own segment-selection logic). Fixed by moving
  that `-ss` to an *output* option instead, which seeks just as fast (no
  frame decoding either way) but writes correct duration.
- **Precise trim (remove intro/outro)** — a Trim… action on library items cuts
  a portion off the start and/or end of a video or audio file. Uses a "smart
  cut" (stream-copy most of the file, re-encode only right at the cut
  boundary) for speed and no quality loss away from the cut, with
  frame-stepping nudge controls and a "Pick exact frame" browser (every
  decoded frame in a short window, click the one to use) for exact
  placement. Generates a preview first — original and trimmed can be played
  side by side — and only overwrites the original file on explicit Accept;
  trimming is not reversible once accepted. Trim previews are written to a
  shared `.packrat-tmp` folder under the media root rather than next to the
  original file, and the dialog now takes up most of the viewport.
- **Fixed Redownload** — "Redownload" previously created a duplicate library
  item pointing at the same file, and usually didn't even re-fetch the video
  (yt-dlp's default skips an existing file). It now genuinely re-fetches the
  file and updates the existing item in place — only resolution and duration
  change; title, tags, season/sequence, year, artist, NFO preference, and
  thumbnail are left exactly as they were. The file is staged in the shared
  `.packrat-tmp` scratch folder and only swapped into place once the download
  fully succeeds, so a failed redownload never touches the original.
- **New: Redownload from different URL** — replaces the file (and the saved
  source URL) from a different link, for when the original source died or
  moved. Shows the new link's fetched metadata side by side with what's
  currently saved, with a checkbox per field to choose what else to
  overwrite (resolution/duration checked by default) — anything left
  unchecked stays as-is. Warns if the new URL already matches another
  library item.
- **Resolution quality tiers** — a new Library card in Settings sets
  low/medium/high resolution thresholds (snapped to standard steps —
  480p/720p/1080p/1440p/4K/8K — via a colored slider), with an option to
  disable the medium tier for a simple low/high split. Resolution values in
  the Library's Details view, Compare Metadata, and the New Download
  preview are now colored red/amber/green to match.

## 2026-07-31

- **Collections: Year and Sequence range** — collections can set a default
  Year (mirrors the existing default Season #) and a Sequence Min/Max range.
  Once a range is set, Sequence # fields for items in that collection become
  a picker instead of a free number, and the Edit Sequence dialog shows the
  full expected range — including a trailing "missing" gap past the last
  downloaded item — not just gaps between items that already exist.
- **Library toolbar and dialog polish** — bulk-edit dialogs gained a
  resizable two-column layout on wide screens and wider dialogs overall; a
  bug where blurred thumbnails couldn't be revealed inside bulk-edit rows was
  fixed.
- **Library/Collections UI consolidation** — the Library toolbar's Mode,
  View, and Pagination controls are now one cog-icon popover that saves with
  a single Apply (previously separate controls, each saving immediately);
  several popovers (sequence-gap warnings, collection field info, Backup
  export info) now open on hover instead of requiring a click; the New
  Download dialog shows Advanced as a permanent side column on wide screens;
  every dialog in the app now only closes via Escape or its close button,
  not by clicking the backdrop; and every collection picker now lists
  options alphabetically by path.
- **Fixed: stale data in the Edit/Move library item dialogs** — editing a
  field, closing without saving, then reopening the same item kept the
  unsaved edit instead of resetting to the saved value.
- **Collection cover art respects Private** — a collection's cover image now
  blurs automatically when the collection is marked Private, with a
  hover-to-reveal eye toggle next to the "Cover art" label.
- **Master privacy switch** — a new "Enable privacy" toggle in Settings (off
  by default) that turns every privacy feature on or off app-wide —
  blurring, lock icons, the reveal-all button, and the Private checkboxes on
  collections/tags all disappear when it's off. Each collection/tag's own
  Private value is preserved underneath, so switching it back on restores
  exactly what was blurred before.
- **Rescan resolution/duration** — the Library item Edit dialog can re-probe
  a file's actual resolution and duration (via ffprobe) and prompts to
  accept or discard the detected values before they're saved, for items
  whose stored metadata has drifted from the file on disk.
- **Settings help text moved into hover popovers** — Settings, Backup, and
  the item Edit dialog now show field help via a hover-triggered info icon
  next to each label instead of an always-visible paragraph underneath.
- **Configurable backup retention** — how many backups are kept before older
  ones are pruned is now a Settings option (including an Unlimited choice),
  instead of being fixed at 14.
- **Dashboard charts** — added library growth over time, a video/audio
  composition breakdown, and top-artists/top-tags-by-usage charts (tags
  respect the privacy setting, excluding private ones from the ranking).

## 2026-07-27

- **Compare list** — a persistent shortlist of library items you're
  comparing (distinct from the existing "Compare Metadata" dialog), with a
  management page and an immersive multi-player view that plays up to 6
  items at once with synced/overridable play, pause, and volume.
- **Bulk sequence editing** — a drag-and-drop dialog for renumbering a batch
  of files at once, with reserved-gap markers, arrow-key reordering, and
  jump-to-position pickers.
- **Missing sequence number detection** — collections and the single-item
  edit dialog surface gaps in a collection's numbering (e.g. "missing: 4, 9,
  12") so incomplete series are easy to spot.

## 2026-07-26

- **Automatic backups** — scheduled settings/library backups with a
  configurable retention policy, a history table with per-run status, and
  the ability to preview or download any past backup from Settings.
