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

## 2026-08-06

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
