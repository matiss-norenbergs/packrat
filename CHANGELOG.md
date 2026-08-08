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
