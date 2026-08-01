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

## 2026-08-01

- **Precise trim (remove intro/outro)** — a Trim… action on library items cuts
  a portion off the start and/or end of a video or audio file. Uses a "smart
  cut" (stream-copy most of the file, re-encode only right at the cut
  boundary) for speed and no quality loss away from the cut, with
  frame-stepping nudge controls for exact placement. Generates a preview
  first — original and trimmed can be played side by side — and only
  overwrites the original file on explicit Accept; trimming is not
  reversible once accepted.
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
