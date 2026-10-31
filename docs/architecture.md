# Architecture

Packrat's backend is a Go/Gin service with SQLite (WAL mode) storage; the frontend is a
React/TypeScript SPA served by the same binary in production. See the root
[`docker-app-plan.md`](../../docker-app-plan.md) for the original long-term spec/vision doc — this
document covers what's actually implemented today, which has grown well past that document's
"working skeleton" starting point.

## Backend package layout

```
backend/
  cmd/server/main.go     entrypoint: config, DB, migrations, queue, WS hub, cleanup sweeps, HTTP server
  internal/
    config/               env-var configuration
    db/                    SQLite connection (WAL, busy_timeout) + migration runner
    models/                domain structs (Download, LibraryItem, Collection, Tag, Artist, Settings, ...)
    repository/            database/sql-based repositories, no ORM
    downloader/             yt-dlp subprocess wrapper: metadata fetch, args, progress parsing, thumbnail fetch
    queue/                  worker-pool DownloadManager + in-memory ProgressStore
    api/                    Gin router, handlers, DTOs
    ws/                     WebSocket hub/client, event types
    backup/                 export/import envelopes, encryption, settings + library + full bundles,
                             scheduled/history-tracked backup runner
    importer/               media-root scanning + ffprobe-based file import
    jellyfin/                Jellyfin client + refresh debouncer
    nfo/                     .nfo sidecar XML generation
    pathsafe/                path traversal prevention (collections, folders, imports)
    fsutil/                  filename sanitization, atomic rename pairs, directory helpers
    imageproc/               shared ffmpeg-based WebP derivative generation + dimension probing,
                             used by library thumbnails, collection covers, and artist images;
                             also full-resolution format conversion for downloadType=image
    imagefetch/               plain-HTTP fetch for downloadType=image (no yt-dlp involved) and the
                             New Download dialog's proxied preview passthrough — both proxy-aware
                             via the same ytdlp_proxy setting yt-dlp itself reads
    imagebackfill/           one-off background sweep: regenerates missing derivatives and
                             backfills thumbnail dimensions for pre-existing rows
    framematch/              perceptual-hash frame matching (ad-hoc job store + durable queue)
    subscriptions/           periodic channel/playlist re-check + ghost/download creation
    thumbnailenhance/        AI upscale/sharpen via a self-hosted Stable Diffusion instance
    hostactions/             env-defined sidebar "Actions" (PACKRAT_ACTION_<N>_*): fixed HTTP
                             requests, e.g. to tools/sd-launcher; never editable from the UI
    nametemplate/            filename templates: {artist}/{title}-style tokens → sanitized path segments
    features/                the optional-feature toggles (Settings → Features) the API and sweeps consult
    strayfiles/              finds files on disk no DB record references (Settings → Library → Find
                             Stray Files); report-only until a delete is requested
    ratelimit/               in-memory throttling of failed logins (delays only; see Login throttling)
    twofactor/               TOTP, secret-at-rest encryption, recovery codes, login challenges
    admincmd/                host-side recovery commands (--reset-password, --disable-2fa)
    version/                 the release version, stamped at build time
```

`backend/cmd/server` also holds `admin.go` (the recovery-command entry point) and `backend/cmd/framematch-bench`
is a standalone tool for measuring the frame matcher; it never touches the app's data.

## API routes live under `/api`

The frontend has client-side routes named `/downloads`, `/library`, `/collections`, etc. — the same
names as several REST resources. Registering the API at those exact top-level paths meant a hard
refresh (or a shared link) on those pages returned raw JSON instead of the app shell, since Gin
matches a registered route before ever falling back to serving `index.html`. All JSON API routes
are grouped under `/api` (see `internal/api/router.go`) to make that collision structurally
impossible, no matter how many more pages are added later. `/media-files` and `/ws` stay
unprefixed since no frontend route shares those names.

## Response compression and static caching

`Compress()` (`internal/api/compress.go`) is a global middleware that gzips SPA assets and JSON API
bodies for clients sending `Accept-Encoding: gzip`, at `gzip.BestSpeed` (this runs on NAS/Pi-class
CPUs: level 1 is ~3x cheaper than level 6 for ~20% larger output). It decides lazily from the
status, headers and first 1 KiB of the body, so handlers don't know it exists. It never touches
`/media-files`, `/local-images`, `/api/image`, `/ws`, `Range` requests (video seeking), non-GET,
non-200, already-encoded or `no-transform` responses, non-text content types, or bodies under
1 KiB; compressed responses get `Vary: Accept-Encoding`, lose `Content-Length`/`Accept-Ranges` and
have strong ETags weakened. Files under `/assets/*` are Vite content-hashed, so `serveSPA` sends
them `public, max-age=31536000, immutable`; `index.html` (including the SPA fallback) is
`no-cache`. There is deliberately no build-time precompression yet — the JS bundle is re-gzipped
per request.

## Frontend bundle is split per route

`frontend/src/routes/index.tsx` loads every page through react-router's route-level `lazy`
(not `React.lazy`/Suspense: a Suspense fallback made first content ~300 ms slower because of React's
reveal throttle, and route `lazy` also keeps the old page on screen until the next is ready). The
layouts, sidebar and auth gate stay in the entry chunk. `vite.config.ts` groups node_modules into
`vendor-react`, `vendor` and `vendor-charts` (recharts, Dashboard only), plus `app-shared` for
`components/ui`, `hooks`, `lib` and `types`; without the groups rolldown emits ~100 tiny shared
chunks. A delegated `pointerover`/`focusin` listener preloads the chunk of any in-app link.
The auth status query is prefetched at module load so it runs in parallel with the initial chunk.

**Desktop client mode.** `frontend/src/lib/server.ts` decides where the app talks to. On the web
(`isDesktop()` false: no Tauri, no `VITE_DESKTOP=true`) every URL stays relative and auth is the
cookie — unchanged. On desktop, `request()` prefixes the saved server address and sends
`Authorization: Bearer` (no cookies, no CSRF header), and every URL the browser loads itself —
`mediaFileUrl`, `imageUrl`, `resizedImageUrl`/`SrcSet`, `previewImageUrl`, `backupDownloadUrl` and
the `/ws` URL — goes through `serverUrl()`/`websocketUrl()`, which add the prefix and `?token=`
(an `<img>`/`<video>` request can't set headers). The backend only ever returns relative paths, so
these helpers are the single place URLs are built. `App.tsx` shows `ConnectPage` until a server is
saved, and the route module skips its auth prefetch until then; `DesktopGate` covers an unreachable
server; a 401 from any non-`/auth/` route clears the token and fires `UNAUTHORIZED_EVENT`.

The Tauri shell is `desktop/` (see its README): `src-tauri/` points `frontendDist` at
`frontend/dist` and `devUrl` at the Vite dev server, so there is one frontend codebase, not a fork.
It is a pure client — no sidecar, no bundled backend — and only the plugin-backed behavior
(notifications, opening links in the system browser) is guarded by `isTauri()`, with the plugins
imported lazily so the web bundle never loads them. `desktop/` is excluded from the Docker build
context (`.dockerignore`).

**Stale chunks after a deploy.** A tab opened before an update still references the old hashed chunk
names; the server answers the missing file with the SPA fallback (200 `text/html`), the dynamic import
rejects and the router surfaces it as a route error. The `RouteError` element on each top-level route recognises
that (`lib/chunkReload.ts`) and reloads once, which fetches the new `index.html`. A `sessionStorage`
timestamp (30 s window) prevents loops: a second failure — or unusable storage — shows the error
page with a Reload button instead. Only the route error is handled: `vite:preloadError` also fires
for the same failure but is redundant, and a handler that calls `preventDefault` there would make
`lazy` resolve to `undefined` before the reload.

## Auth and CSRF

The app is single-user (no registration beyond a one-time setup wizard) but is fully
session-gated: `RequireAuth` covers every `/api/*` route except `/api/health` and
`/api/auth/{status,setup,login,login/2fa,logout}`, plus `/media-files/*` and `/ws`. Sessions are opaque
64-char hex tokens validated against a server-side sessions table (not signed/stateless JWTs),
30-day expiry, cookie `packrat_session` (`HttpOnly`, `SameSite=Lax`). Each row also records the
device that logged in (client, IP, truncated User-Agent), a throttled `last_seen_at`, and a separate
random `public_id` — the only handle the sessions list/revoke API exposes, so the token never leaves
the server after login.

`Secure=false` is deliberate, not an oversight — the app is commonly run over plain HTTP on a
trusted LAN, and requiring HTTPS would break that default deployment. CSRF is handled separately
via a double-submit cookie (`packrat_csrf`, readable by JS, echoed back as `X-CSRF-Token` on every
mutating request) rather than relying on cookie security flags alone. Its value is an independent
random string, never the session token: the cookie is script-readable, so sharing the secret would
hand any XSS a working session credential (it is also accepted as a bearer token). Pre-fix sessions
are healed on their next cookie-authenticated GET (`healLegacyCSRFCookie`). See
[`api.md`](api.md#auth-and-csrf) for the full mechanics.

The same session token can also be presented as a bearer token (or, GET-only, a `?token=` query
parameter for `<img>`/`<video>`/WebSocket URLs) so the desktop app — a different origin, where
cookies and `document.cookie` don't work — can authenticate. `RequireAuth` records how each request
authenticated, and `RequireCSRF` only enforces the double-submit check for cookie-authenticated ones
(and fails closed if that marker is missing). A small allowlist-only CORS middleware
(`CORS_ALLOWED_ORIGINS`) admits the desktop app's origin; the web UI is same-origin and unaffected.

### Login throttling and the client IP

Gin trusts every proxy by default, which would let any client pick its own address with a forged
`X-Forwarded-For`. `SetupRouter` therefore trusts **none** unless `TRUSTED_PROXIES` (comma-separated
IPs/CIDRs) says otherwise, so `c.ClientIP()` is the real connection address. (Behind Docker Desktop on
Windows/macOS the container may see every client as one gateway IP, so per-IP limits then behave like
global ones — which is why the limits below delay rather than lock.)

`internal/ratelimit` counts **failures only** — wrong passwords (login, change password, disabling 2FA
or regenerating recovery codes) and wrong 2FA/recovery codes. Normal authenticated traffic is never
limited. Limits (constants in the package): 10 failures per IP per 15 min block that IP for 15 min
(correct attempts included); globally, 30 password failures or 10 code failures per hour start a
cool-down on that step for everyone — 15 min, doubling on repeated trips up to 4 h, relaxing after a
quiet day. A completed login resets that IP's counters. It is in memory, mutex-guarded, bounded
(oldest IP evicted), uses an injectable clock, and resets on restart. Blocks answer `429` +
`Retry-After` + `{error, retryAfterSeconds}` and are logged by IP only. There is deliberately **no
permanent lockout**: with one account, a hard lock would let anyone lock the owner out on purpose.

### Two-factor auth (TOTP)

Opt-in per account (`internal/twofactor`). TOTP is RFC 6238 via `github.com/pquerna/otp`
(Apache-2.0): SHA-1, 6 digits, 30 s, 160-bit base32 secret, ±1 step of drift, and the last accepted
step is stored so a code can't be replayed. Secrets are encrypted at rest with AES-256-GCM (bound to
the user id) under a key from `PACKRAT_SECRET_KEY`, or by default an auto-generated `0600` key file
`packrat-secret.key` next to the database (so it lives in the data volume). Without the key the
secret can't be read; `packrat --disable-2fa` needs no key and is the way out. Recovery codes
(10 × `XXXX-XXXX`, ~40 bits) are stored only as keyed HMAC-SHA256 hashes, compared in constant time,
deleted on use.

With 2FA on, `POST /api/auth/login` with the right password returns a **challenge**
(`{twoFactorRequired, challengeToken, expiresInSeconds}`) and **no session** — no cookie, and no
token for `X-Client: desktop` either. The challenge is 256 random bits kept in memory (hashed),
single-use, valid 5 minutes, and destroyed after 5 wrong codes. Only `POST /api/auth/login/2fa`
turns it into a session (via the same `respondWithSession`), and `respondWithSession` is reachable
only from setup (no user yet, so no 2FA possible), a login of a non-2FA account, and that endpoint.
The public `/auth/status` reveals nothing about 2FA. Backups are built from settings and library
tables only, so they never contain 2FA secrets, recovery hashes or the key (pinned by a test).

### Appearance preferences
Theme and accent live in `user_preferences(user_id, key, value, updated_at)` — user-scoped
(`ON DELETE CASCADE`, like `sessions`), unlike the global `settings` table, so they follow the
account. `models.UserPreferenceSpecs` is the single allowlist (keys, allowed values, defaults);
`UserPreferencesRepo` fills defaults for unset keys, so a new key needs no migration. Served by
`GET/PATCH /api/auth/preferences`. Like 2FA data they are not in any backup bundle (pinned by a test).
On the client the server is the source of truth once signed in, while localStorage (next-themes' own
key, `packrat-accent-color`) is only a cache read before first paint and on the logged-out pages, so
nothing flashes. `useSyncAppearance`, mounted in every authenticated layout (management, Browse and the compare player) and never on logged-out pages, applies the server
values on the **first fetch that completes after mount** — never on a later refetch, so a slow
response can't overwrite a choice just made — which also refreshes the cache. Changes apply locally
at once and PATCH only the changed key; a failed save toasts and keeps the local value. There is no
migration of old browser values: an account with nothing stored gets the defaults.

### Saved table layouts
What a user did to a list table (which columns are hidden, how it is sorted and how wide the columns are) is stored per account in `user_table_layouts(user_id, table_id, layout, updated_at)`,
primary key `(user_id, table_id)`, `ON DELETE CASCADE`. It has its own table rather than rows in `user_preferences` because
the value is a structured JSON document that the client fetches **once for every table** (`GET /api/auth/table-layouts`),
whereas preferences are a fixed set of enum keys. Like preferences and 2FA data it is not in any backup, export or bundle
(pinned by `backup/no_table_layouts_test.go`). The API is the only validator: `models.ParseTableLayout` accepts exactly
`v` (1), `sort`, `hidden` and `widths` with the bounds in `docs/api.md`, rejects unknown fields and stores canonical JSON,
so later client features need no backend change. At most 100 tables per account (a 409 for a new one beyond that).

On the client `useTableLayouts` (key `["tableLayouts"]`, `staleTime: Infinity`, mounted in `AppLayout`) holds all layouts;
saving or clearing writes the cache with `setQueryData`. The key is outside `["auth", ...]`, so `markLoggedOut` and the 401
handler drop it with every other protected query, and the desktop's server switch reloads the app, so a signed-out user's
layouts never survive. `useTableLayout(tableId, defaults, opts)` is the reusable state (it knows nothing about DataTable, so a
non-table list can use it): **saved** (the account's layout or null), **baseline** (`saved ?? defaults`) and **working**. The working
layout lives in component state only and is never saved automatically; until the user edits, `working` simply *is* the
baseline, so a saved layout that arrives after mount is adopted without overriding an edit made meanwhile, and leaving the
page and coming back starts from the baseline again. `dirty` compares normalized forms (field and key order, empty versus
missing `hidden`, keys of columns that no longer exist, non-hideable keys in `hidden` and widths equal to the default are ignored).
`widths` holds **overrides only**: normalization (`normalizeTableLayout`, fed the per-column default and minimum by DataTable through
`resizableWidths`) drops a width equal to the column's default width (its `width` or the type default, raised to its `minWidth`), one
for a column that does not exist or is not resizable (flex, icon, switch, `resizable: false`), raises a width below the
column's minimum to it (never below the backend's 24) and caps it at 2000; keys are sorted and an empty map is omitted. Hidden
columns keep their stored width. So dragging a column back to its default is not a change, and the default widths can change in code
without invalidating saved layouts of columns the user never resized. `save()` PUTs the working
layout, `clear()` DELETEs and applies the defaults, `restore()` is local; Save and Clear toast only when the server responds
(an error toast leaves the working state alone) and a second one while a request is in flight is ignored.

**Library sort.** The Library sort is not a Settings key any more (`library_sort`, `librarySortKey` and `librarySortDir` were removed;
migration 000051 deletes the row and clients that still send the fields are ignored). `LibrarySortProvider` (`components/library/LibrarySortContext.tsx`,
mounted in `AppLayout` next to `RevealAllProvider` so it sits above both `/library` and `/library/:id` and survives navigation between them)
wraps `useTableLayout("library", ...)` configured from the list view's column specs (`lib/libraryListColumns.ts`, see "Library list view" below: known, hideable, sortable
and resizable keys, the default hidden columns) with `downloadedAt` descending as `defaultSort`. It exposes the working **layout** (sort, hidden, widths) and `setLayout`
as well as the sort.
The **baseline** is the sort of the saved `library` layout, else the default; the **working** sort starts as the baseline (a late layout is adopted unless
the user already changed the sort), applies instantly to every view, and is gone on a reload. `useLibrarySort()` (`hooks/useLibrarySort.ts`) exposes
`sort`, `baseline`, `ready`, `differs`, `setSort` and `saveSortAsDefault`; without the provider (`BrowseLayout`, the Browse item page) it returns the saved
layout's sort or the default, read-only. Library data queries wait for `ready` (the layouts answered or failed) so they never fire with the default
and refire with the saved sort. `saveSortAsDefault` (`useSaveTableLayoutSort` in `useTableLayout.ts`, reusable by other lists) reads the **raw** stored layout
(not the normalized one, which drops `hidden`/`widths` of columns the Library sort does not know), replaces only `sort` (omitted when equal to the default),
and PUTs it, or DELETEs the layout when only `v` is left; one request at a time, a toast only when the server answers, and the layouts cache is updated, so the
baseline becomes the saved sort. Backups: `ApplySettingsBundle` skips retired setting keys (`library_sort`) and does not count them, so an old backup or settings
file cannot bring the row back.

**Library list view.** `LibraryListView` is a `DataTable` in **controlled (server) mode** (`tableId="library"`, the id of the shared sort layout): `rows` is the
current page's items, the page owns the query (URL filters, `usePageState`, the sort from `useLibrarySort`, pagination from Settings), and the table never sorts.
- *Shared column specs.* `lib/libraryListColumns.ts` (no JSX, no component imports, so no cycle) is the single source of the column keys, labels, widths, hideable /
  default-visible and sortable flags, the two extra sort keys and the default layout. The list builds its `ColumnDef`s from it (adding header cell, cell and `sortValue`), and
  `LibrarySortProvider` builds its `useTableLayout` options from it. The provider needs them because it sits above the page and cannot see the columns, while the layout
  normalization drops `hidden` and `widths` for keys it does not know: without the specs a saved layout's hidden columns and widths would be ignored on load and lost on
  Restore. Its default layout hides the columns that are off by default, the same set `DataTable` computes, so Restore / Clear and the dirty dot agree. A sortable
  column's key **is** the server sort key (`title`, `seasonNumber` for Season/Episode, `year`, `duration`, `downloadedAt`), so `layout.sort.key` is what the queries send;
  `sortValue` only marks the column sortable. The toolbar's `filename` and `sequenceNumber` sorts are not columns and go through `extraSortKeys`.
- *Layout ownership.* The table's `layout` / `onLayoutChange` are the provider's working layout, so a header click, the toolbar dialog, the grid and the folder
  view all read and write the same sort. The old `LibraryColumnsContext` / `LibraryColumnsProvider` / `LIBRARY_COLUMNS` and the toolbar's Columns dropdown are gone:
  hidden columns are part of the saved layout now, and the table's own Columns menu and Layout popover (in its toolbar row) replace them. "Save as default" still saves
  only the sort (`useSaveTableLayoutSort`, which keeps the stored `hidden` / `widths`).
- *Selection adapter.* `useLibraryListSelection(items)` returns an `IdSelection<number>` over the Library's persisting `SelectionContext`, passed as `selectionState`:
  `toggle` (ctrl / cmd click, the checkboxes) adds or removes one item and accumulates across pages; `selectOnly`, `selectAll` (a click, a drag, a shift range, the header
  checkbox) and `clear` replace the whole selection and clear selected collections too. Ids always come from the current page, so they are turned back into items there.
  The returned object changes only when the selection does (its mutators are `useEvent`s), so the memoized rows re-render only when their `selected` flag flips. The
  controlled table does not clear the selection on a page, search or sort change, so it persists like the grid's. The grid and folder views keep using the context directly.
- *Row actions and height.* The "⋮" column is gone; row actions are the table's `contextMenu`, for exactly one target row (a right-click on an unselected row selects only it through the adapter first; on one of several selected items it returns `[]`, so no menu). `libraryItemActions.tsx` is the single definition of an item's actions as data (`LibraryItemAction`: labels, icons, order, separators, submenus, destructive / disabled flags, ghost / image / audio / feature gating) plus `useLibraryItemActions(fixedItem?)`, which returns `actionsFor(item)` and a `host` with every dialog and mutation hook. `LibraryItemActionsMenu` (grid cards, folders, the item page) renders the data with `DropdownMenu` and mounts one host per card, bound to its item; the list mounts one host for the table and `actionsFor` makes the clicked item the dialogs' target (`toContextMenuItems` converts the data; the dialog opens from `onSelect` like on the other pages with a context menu). `LibraryPage` gives the list branch a `flex h-full min-h-0 flex-col gap-6` root (title `shrink-0`), so DataTable's `min-h-0 flex-1` fills `<main>` and the scroll box is `h-full`; nothing guesses a `calc(100vh - N)` any more, and `<main>` never scrolls in the list. The grid and folder branch keeps its scrolling page with the sticky toolbar.
- *Cells.* The cells that depend on page state (reveal, the current URL for the title link's `from` state) are small components reading their context, so `COLUMNS` is a
  module constant. The old "selection active" coupling is gone: the title link, the thumbnail reveal, the tags popover and the actions menu stay live with a selection and
  never select the row (links and buttons are skipped by the table's interactive-target guard; a blurred thumbnail's wrapper carries `data-no-row-select`).
  `getRowLabel` hashes the title of a blurred, unrevealed item.
- *One toolbar.* `useLibraryToolbar()` (`useLibraryToolbar.ts`) holds all state of the Library toolbar (bulk dialogs, the Filters & Sort draft, the display
  settings draft, the URL filters and the `update` helper). `LibraryToolbarActions` (Add item, Bulk operations + dialogs, Clear, "N selected"),
  `LibraryFiltersButton` (button + dialog) and `LibrarySettingsPopover` (the cog) render from it. The classic sticky `LibraryToolbar` (grid, folders)
  composes them with its own search input; the list view calls the hook once and passes them to DataTable's `toolbar`, `filters` and `layoutActions`
  slots and the shared `update("q", …)` to `search` (controlled; the page-state reset keeps it at one request per query). `LibraryPage` mounts either
  the sticky wrapper + classic toolbar or the list view, never both. The "Select files or collections to bulk edit" hint is gone from all views.
- *Saved layout without `hidden`.* A stored `library` layout with no `hidden` key (one written by "Save as default") gets the default hidden columns:
  `useTableLayout`'s `hiddenWhenUnset` option, set by the provider, and DataTable's `defaultHiddenWhenUnset` prop for the table's own copy of the
  hook (Restore, dirty). An explicit `hidden`, even `[]`, wins; other tables are unchanged and `saveSortAsDefault` still edits the raw layout's `sort` only.
- *Footer.* The table's own, through the `pagination` prop (with pagination off a count-only config: `hidePages: true`, so "N items" and the selected count show without page buttons), and
  `selectedCount={approxCount}`, so the footer shows the toolbar's number. `LibraryPagination` is now used by the grid and the folder view only.

`DataTable` uses it when a table passes a `tableId` and has a `hideable`, a sortable or a resizable column; without a `tableId` hiding and
sorting still work but nothing can be saved. Passing both `layout` and `onLayoutChange` makes the page own the working layout (the
future Library list); the Layout popover then acts on that layout. `hidden`, `sort` and `widths` are all edited by the table (controlled mode carries all three).
Dialog tables do not opt in. While the layouts query has not answered, a table with a `tableId` shows its loading state (and the
footer placeholder) instead of rendering the defaults and re-arranging a moment later; if the fetch fails the defaults apply.

Failed attempts are stored (time, IP, step; pruned after 30 days) in `login_failures` and exposed to
the owner after login as the dismissible "N failed login attempts since your last login" notice.

### Admin commands

`cmd/server` handles `--reset-password` (prompts twice without echo, or `--password-stdin`; never a
password argument) and `--disable-2fa` before the server starts. They open the database from the
normal config, apply pending migrations, act, exit non-zero on error, and delete **all** sessions.

## Collection root paths stay under `MEDIA_ROOT`

The original spec's Collections examples show absolute paths (`/media/music`), Sonarr-root-folder
style. Since only one Docker volume is mounted, letting the Collections API accept arbitrary
absolute filesystem paths would be a straightforward arbitrary-file-write primitive. A
collection's `rootPath` is instead validated exactly like a download's `folder` field, via
`pathsafe.ResolveUnderRoot(MediaRoot, rootPath)`: it's a named folder preset *under* `MEDIA_ROOT`,
not an arbitrary path. When a download specifies both a collection and a `folder`, the folder
resolves as a subfolder within that collection's root (nested `ResolveUnderRoot` calls). The same
function backs collection creation, download folder resolution, move, and import.

## Concurrency limit is runtime-editable

`DownloadManager.SetWorkerCount` resizes the worker pool live — each worker has its own `stop`
channel that only gates whether it picks up its *next* job, while every in-flight download derives
its context from a single stable `rootCtx` set once in `Start`. Shrinking the pool (e.g. via
`PATCH /api/settings`) never cancels a download that's already running; it just stops that many
workers from claiming new jobs. The setting is persisted via `SettingsRepo` and re-read at startup,
so a saved value survives a restart instead of reverting to the `MAX_CONCURRENT_DOWNLOADS` env var.

A separate `downloadTimeoutMinutes` setting (0 = no limit) derives each download's context from
`rootCtx` with a deadline; a run that exceeds it is killed and classified as a timeout-flavored
failure rather than a generic error.

## Data flow (single download, end to end)

1. `POST /downloads` validates the request, resolves the destination folder against `MEDIA_ROOT`
   via `pathsafe.ResolveUnderRoot`, inserts a `queued` row, and pushes the ID onto the queue
   manager's job channel.
2. A worker goroutine (one of `maxConcurrentDownloads`) picks up the job, fetches metadata via
   `yt-dlp --dump-json`, then runs the actual download with `--progress-template` emitting
   structured progress lines.
3. Progress is kept in an in-memory `ProgressStore` and flushed to SQLite only on status change —
   the DB is never written to on every progress tick.
4. `progress`/`completed`/`failed`/`queue_update` events are broadcast over WebSocket, throttled to
   roughly once per second per download.
5. On success, a `library` row is created (with any `tags`/override fields from the request
   applied), an `.nfo` sidecar is written if enabled, a Jellyfin refresh is triggered if configured,
   and the frontend's Library page picks the new row up via the WS `completed` event triggering a
   refetch.
6. A `history` row is written for every terminal outcome (completed/failed/cancelled/interrupted),
   independent of the live queue — deleting a download's queue row never removes its history entry.

Playlist (`POST /downloads/playlist`) and batch (`POST /downloads/batch`) submissions both funnel
through the same per-item enqueue path (`enqueueDownload`), just with the entry list resolved
server-side (playlist) or supplied as an array (batch) instead of one URL at a time.

## `downloadType=image`: a direct-URL download with no `yt-dlp` involved

`yt-dlp`'s extractors are built for video-hosting pages, not a bare link straight to an image file —
rather than stretch it to fit, `imagefetch.Fetch` does a plain HTTP GET (Content-Type validated
against an allowlist, written atomically via temp-file-then-rename). `queue.DownloadManager.runOne`
forks on `d.DownloadType == "image"` at exactly two points: the metadata-fetch step (skipped
entirely — `titleFromURL` derives a fallback title from the URL itself) and the actual
fetch/download step (`runImageDownload` instead of `ytdlp.Run`). Everything after that — duplicate
detection, thumbnail-tier generation (the image doubles as its own thumbnail), redownload, the
queue's progress model — is unmodified, since both paths converge back onto the same
`downloader.RunResult` shape.

**Proxy routing.** yt-dlp reads the `ytdlp_proxy` setting via its own `--proxy` flag, but a plain
`http.Client` fetch doesn't get that for free — `imagefetch.Fetch`/`imagefetch.Open` both take a
`proxyURL` parameter and build an `http.Transport{Proxy: http.ProxyURL(...)}` from it, reusing the
exact setting value/scheme convention (`socks5://`/`http://`/`https://`) yt-dlp already uses. This
matters beyond just the real download: the New Download dialog's live preview `<img>` — for an
image-type URL *and* for a regular video/audio URL's yt-dlp-reported thumbnail — used to be a raw
client-side `<img src>` pointing straight at the external URL, which has no way to honor a
backend-configured proxy at all. `GET /api/downloads/preview-image` (`imagefetch.Open`, streaming
instead of writing to disk) fixes both at once: the frontend's `previewImageUrl()` helper rewrites
every preview `<img src>` to go through this endpoint rather than the raw external URL, so a preview
never leaks outside whatever network path the real download would use. `GET /api/proxy/status`
(a short-timeout `HEAD` through the configured transport) backs the sidebar's live reachability dot,
independent of any actual download or preview happening.

## Full-text search

The `library` table has an FTS5 virtual table (`library_fts`) kept in sync via triggers, covering
title/uploader/artist/description. `GET /api/library?q=...` queries it directly rather than a
`LIKE` scan. Pagination, sorting, and collection/year/tag filters all compose with the search query
in the same `LibraryRepo.Query` method.

## Privacy: private collections and private tags

Artists have the same explicit flag (`artists.is_private`, migration 000049; `PATCH` with the field omitted means
unchanged), but it is deliberately narrow: only the Artists page's right-hand image panel blurs on it (frontend-gated
on `privacyEnabled && artist.isPrivate`; the API returns the raw flag). No item response, Browse or dialog uses it, and
library backups don't carry it yet (restore creates public artists; see `TODO.md`).

An item is `blurred` if the privacy master switch (`privacy_enabled`) is on **and** either of two
independent things is true: its collection (or an ancestor collection) is marked private, or any tag
assigned to it is marked private. Collection privacy is inheritance-aware (`effectivePrivacyMap`
over the full collections list, resolving the `parentId` chain); tag privacy has no hierarchy — a
tag is just private or not. Blur status is computed at read time from current collection/tag state,
never cached on the item row.

That decision lives in exactly one place: `ItemPrivacy.Blurred(collectionID, tagNames)`
(`internal/api/item_privacy.go`), loaded once per request with `LoadItemPrivacy` (master switch,
effective collection privacy, private tag names). It returns false whenever privacy is off, so no
endpoint can leak a blur flag with the switch off. Every endpoint that returns library items builds
its response through `ItemResponder` (`Responses` for lists, `Response` for one item), which
batch-loads tags and gallery counts and applies the resolver: `GET /api/library` and
`/library/:id`, the compare list, refresh-metadata, trim accept, the thumbnail writes
(`writeThumbnailAndRespond`, shared by thumbnail set/quick-grab/redownload, gallery apply and
frame-match accept), file import and ghost creation. Single-item responses re-read the item's tags
from the DB, so they reflect what was actually stored.

The downloads list is the one deliberate exception to the *tags* half of the rule: queue rows blur
by collection only (`Blurred(d.CollectionID, nil)`), because a download has no tags until it
completes into a library item. It still gets the master switch and ancestor handling from the same
resolver. The collections list's `effectiveIsPrivate` uses `effectivePrivacyMap` directly (it is
not an item response). The compare list shares all of this, so a private item shows blurred in the
compare grid too, gated by the same reveal-all mechanism.

The AI Enhancement history list (`GET /api/thumbnail-enhancement/history`) carries `blurred` from the same
resolver (loaded once per request, tags batched for the page's items; the handler takes the collections/tags
repos, `thumbnailenhance.Deps` is unchanged). The "Enhancing:" header has no flag in the `enhance_progress`
event, so it asks the single-item endpoint (`useLibraryItem`) and fails closed (hashed) until that answers.

## Ghost items are not a separate table

A ghost item is just a `library` row with `status="ghost"` and empty `filename`/`path` (the same
empty-string sentinel `LibraryRepo.ClearFile` uses elsewhere) — no schema change was needed to
support them. Three independent paths converge on this state: creating one directly
(`CreateGhostLibraryItem`), deleting just a real item's file (`DeleteLibraryItemFile`/
`ClearFile`), or the on-demand `scan-missing` sweep finding a file gone from disk.
`fetchGhostThumbnail` (`ghost_handler.go`) is shared between ghost creation and the Library
toolbar's bulk "Download thumbnail(s)" action — it always writes only the `ImagesRoot`-relative
WebP tiers, never the `MediaRoot`-relative `thumbnail` field, since a ghost has no `MediaRoot`
location to anchor a sidecar file to.

## Thumbnail/image derivatives

`imageproc.GenerateTiers`/`GenerateTiersFromPath` (ffmpeg shell-out, never a cgo image library) is
the one shared pipeline behind every resized-image feature in the app: library thumbnails
(small/medium), collection covers (small/medium/original), and artist images (a single 400px
tier). All tiers of one call come from a single ffmpeg invocation (`split` filter, one scaled
branch + output per tier), so the source is decoded once. Collection-cover and artist-image writes additionally share a common dual-source request
pattern (`sourceRelPath` — an existing file under `MEDIA_ROOT` — or `imageBase64`+`filename`, a
fresh upload) via `resolveImageSourceBytes` (`internal/api/image_source.go`). All of these
derivatives live under a separate `ImagesRoot`/`/local-images/*` static tree, distinct from
`MEDIA_ROOT`/`/media-files/*`.

A library item's **original** sidecar thumbnail's pixel dimensions (`thumbnail_width`/
`thumbnail_height` columns) are probed once, header-only (`image.DecodeConfig` — no full pixel
decode), whenever the original file is (re)written — set, redownloaded, imported, enhanced, applied
from the gallery or a frame match, etc. — and persisted alongside the small/medium derivative
paths. This avoids the frontend ever loading an image client-side just to read its size. There's no
single funnel every write path shares (`writeThumbnailAndRespond` only covers the four gin-routed
thumbnail endpoints), so the probe is duplicated at each of the ~9 independent write sites rather
than centralized. Pre-existing rows are backfilled via the `imagebackfill` sweep. These two columns
are deliberately excluded from `backup.LibraryItemEntry` — a disposable derived value, not worth
including in a portable export.

The **thumbnail gallery** (`thumbnail_gallery` table, `ON DELETE CASCADE` with the library item) is
a separate, per-item list of saved candidate images, independent of the one active thumbnail —
populated from "Save in Thumbnail Gallery," a specific frame from "Choose from Video," or a Frame
Matching result. `readCurrentThumbnail` (`thumbnail_gallery_handler.go`) falls back from the
full-res `MediaRoot` original to the best available `ImagesRoot` derivative, so even a ghost item's
URL-fetched thumbnail (which only ever gets derivative tiers) can be saved to its gallery. Applying
a gallery image reuses the same `writeThumbnailAndRespond` finish path as `SetLibraryThumbnail` and
Frame Matching's accept action, keeping derivatives and stale AI-enhancement backups consistent
across all three thumbnail-setting entry points.

## Frame matching

`internal/framematch` finds the video frame that best perceptually matches a reference image
(pHash: a coarse 1fps sweep, then a fine windowed pass around the top candidates) — not duplicate
detection. Two independently-triggered paths share the same `Match()` core and a package-level
mutex that serializes every match regardless of trigger, since the CPU-bound ffmpeg decode
shouldn't run two-at-once on a resource-capped container:

- An in-memory, non-persistent `framematch.JobStore` backs the single-item ad-hoc endpoint — a job
  vanishes on server restart.
- The `frame_match_queue` table plus `framematch.RunQueue`, a single long-lived background
  goroutine started once at server boot, polls the table and processes rows one at a time — backs
  the bulk action and the Frame Matching review page. Accepting or discarding a row deletes it
  (a working queue, not a history).

`ResolveReferenceImage` is shared by both paths so `"url"`/`"current"` mode resolves identically
either way; it deliberately avoids `YtDlpService.FetchThumbnail`'s `--convert-thumbnails`
postprocessor (known to fail silently on AVIF) in favor of an explicit fetch-raw-then-decode step.

## Subscriptions

`internal/subscriptions` periodically re-checks a saved channel/playlist URL and, for each
genuinely new upload, either enqueues a real download (`AutoDownload` on) or creates a ghost
placeholder (off) — reusing the ghost-creation and download-enqueue *logic*, but **not the code**:
`checker.go`'s comment is explicit that this is a deliberate duplication to avoid an import cycle
(package `api` already imports `subscriptions` to expose the "check now" endpoint, so the reverse
import isn't possible). Downloads triggered this way go through the exact same
`queue.DownloadManager.Enqueue` as every other download source — same live queue, same WebSocket
progress events, same worker-pool concurrency limit. Subscribing baselines every currently-existing
upload as already-seen (`BaselineOnCreate`) without creating anything, so a new subscription only
ever surfaces uploads from that point forward. There is no per-subscription goroutine/ticker — see
Retention sweeps below.

Every entry is recorded (`RecordSeenEntry`) under a `sourceID` — the extractor's own `entry.ID` when
`--flat-playlist` provides one, `entry.URL` otherwise. Not every extractor populates `id` in flat-
playlist mode (some sites' channel/listing pages only ever return `url`/`title`); without the URL
fallback, every entry from such a source would fail the "have we seen this?" check forever, since
there'd be nothing to key it by — baselining, scheduled checks, and manual "Check now" would all
silently record zero entries no matter how many uploads actually exist. `RecordSeenEntry` also runs
regardless of whether the auto-download/ghost-creation step it's paired with actually succeeded — an
entry that fails to enqueue is still recorded (with no `library_item_id`, same shape as an
unactioned new entry) rather than skipped, which is what stops a persistent per-entry failure from
being silently retried on every future check and never surfacing anywhere.

## Collection-level defaults for new downloads

Optional collection fields exist to save repetitive manual entry when adding files to a collection.
`seasonNumber` and `artistId` (below) and `year` (direct only, like the season) are applied
client-side when a collection is picked in the download dialogs and are not enforced server-side.
The collection's **`filenameTemplate`** is different: `POST /api/downloads` applies it server-side
whenever the request names the collection and carries neither a literal filename nor a template of its
own (an explicit choice at request time always wins); that is the shared enqueue path of the single and
batch endpoints, so subscription-queued downloads don't get it. The two season/artist rules:

- **`seasonNumber`** — **direct only**. A download placed into a collection with this set
  defaults its own Season # to it; a sub-collection with no season of its own is *not* defaulted
  from an ancestor, even if one has a value. This matches "current parent collection," not a
  tree-wide inheritance search.
- **`artistId`** — **ancestor-aware**. A download placed into a collection walks up the
  `parentId` chain (starting at the selected collection itself) and defaults its Artist to the
  first one it finds set, supporting layouts like `root/some-folder/artist/season/file` where the
  artist is set several levels above where files actually land. Implemented client-side as a pure
  helper (`resolveInheritedArtistId` in `frontend/src/lib/collectionTree.ts`) over the full
  collection list already in memory — there's no server-side computed field for it, unlike
  `effectiveIsPrivate`, since it only affects a UI default-fill, not blur/access logic.

In both dialogs, selecting a *different* collection only fills the field when that collection (or,
for Artist, an ancestor) actually has a value — it never clears a value the user already typed in.

## Backup and restore

The `backup` package builds and applies **three** kinds of portable JSON bundle — settings,
library, and `full` (settings + library combined) — each wrapped in a shared envelope
(`packrat`/`version`/`kind`/`exportedAt`/`encrypted`/`data`) optionally encrypted with a
user-supplied passphrase (`backup/crypto.go`). `full` isn't a separate data model: `BuildFullBundle`
just calls the existing `BuildSettingsBundle`/`BuildLibraryBundle` verbatim and wraps both under one
envelope. The settings/library import endpoints were widened to accept `kind: "full"` in addition
to their own (`OpenAny`, checking membership in an allowed-kinds list instead of one exact kind) and
just pull out their own half — so a full-kind file can be fed into any of the three import entry
points, not only the dedicated one. The library bundle never ships media bytes: it references
collections/artists/tags by name/path rather than local numeric ID (so it's portable across
installs) and re-populates a library by **re-queuing downloads** from each item's saved
`originalUrl` on import (or recreating it as a ghost placeholder, in `ghostOnly` mode), not by
copying files. Import is additive-only — it matches existing collections/tags/artists by name and
creates only what's missing, and a name collision on one entry is skipped rather than aborting the
whole import.

`backup.RunBackup`/`RunScheduledBackupIfDue` (`backup/auto.go`) is a second, disk-resident path
layered on top of the same bundle builders — it always writes an **unencrypted** `full` bundle to
`BackupsRoot` (there's nowhere to prompt for a password unattended) and records a `backup_history`
row for every attempt, success or failure, so the history table doubles as a health check. It isn't
a dedicated cron: "due" is checked on the same shared hourly sweep described in Retention sweeps
below, so worst-case drift from the configured interval is under an hour. Old backups are pruned to
a configurable retention count after every run.

## Crash recovery

On startup, `DownloadsRepo.MarkInterruptedIfActive` scans for rows left in `queued`,
`fetching_metadata`, `downloading`, or `processing` status (i.e. anything a crashed/restarted
process was mid-flight on) and marks them `interrupted`. Nothing is silently resumed — the user
must manually retry from the Downloads or History page.

## Live image resizing

`GET /api/image` (`api/image_handler.go`, `imageproc/resize.go`) resizes a stored image on demand
to a whitelisted width (and optional height cap) as WebP, reusing the ffmpeg path of
`imageproc.GenerateWebP` (`GenerateWebPBox` adds the height cap). It is an addition to, not a
replacement for, the pre-generated small/medium tiers, which stay the path for the hot
grid/list/strip views; today only the Browse hero uses it.

- **Cache:** `CACHE_ROOT` (default `./data/cache`, created on first use, deliberately outside the
  static trees). Key = sha256 of (root, path, source mtime, source size, w, h), so an in-place
  overwrite of the source simply misses. Files are written to a temp name then atomically renamed;
  every hit touches the file's mtime, which is the "last accessed" time.
- **Concurrency:** identical in-flight keys are coalesced in a small in-flight map (one ffmpeg
  per key; followers wait on the leader, which runs detached from any single request's context),
  and at most 2 resizes run at once (a channel semaphore, same shape as `embedMetadataSem`).
- **Eviction:** `cleanupImageCache` runs on the shared hourly ticker and deletes cache files not
  accessed within `imageproc.ResizeCacheMaxAge` (7 days, one constant). Orphaned variants of
  overwritten sources age out the same way.

## Retention sweeps

A single shared hourly ticker in `main.go` (`historyCleanupInterval = time.Hour`) also runs the
image-cache sweep (see Live image resizing) and drives five
independent, sequential, no-op-if-not-due sweeps per tick — one goroutine, not five separate
tickers: history/download-log retention, thumbnail-enhancement history cleanup, due subscription
checks (`subscriptions.RunDueChecks`), and due scheduled backups
(`backup.RunScheduledBackupIfDue`). History/log retention deletes terminal (non-active) rows older
than two independently-configurable settings — `historyRetentionDays` (History page) and
`downloadLogRetentionDays` (Downloads/Logs pages), `0` meaning keep forever — each with a manual
"clear all now" action that ignores age entirely. Hourly granularity is deliberate: the smallest
configurable subscription/backup interval is 6h, so checking hourly is more than sufficient
resolution without needing per-feature scheduling infrastructure.

## Floating action dock

`components/FloatingActionDock.tsx` is a reusable slot for floating buttons. `<FloatingActionDock>`
is mounted once per layout (only `AppLayout` for now) wrapping the page content; it renders a fixed
container (bottom-left of the content area, `md:left` past the 14rem sidebar, `z-40` — above content,
below dialogs `z-50` and banners `z-[100]`, `flex-col-reverse` so the first action is at the bottom,
`pointer-events-none` except on the buttons, `empty:hidden`) and exposes that DOM node through context.
Pages/features render `<FloatingAction icon label onClick active? order? />`, which portals a round icon
button into the node (state-backed callback ref, so it works on the first render); mounting adds the
button, unmounting removes it, and without a dock above it renders nothing. The dock owns all
positioning, so features never position themselves. `RevealAllFloatingAction` is the first user; the AI Enhancement page also uses it and reads only the provider's
`revealAll` flag (no per-item keys, no click-to-reveal).

**Dock-aware footers.** A page footer must not sit under the dock button, but only while the dock actually has one
(`RevealAllFloatingAction` renders nothing with privacy off or no private content). `styles/globals.css` defines the
custom variant `dock-occupied`: `body:has([data-slot="floating-action-dock"]:not(:empty)) &`. `:has()` on `body` is needed
because the dock is a *sibling* of the layout content, not an ancestor of any footer; `:empty` works because the dock
renders nothing but portaled buttons (and is `empty:hidden`). `lib/dockClearance.ts` exports the two class strings
(`DOCK_FOOTER_ROW`, `DOCK_FOOTER_LABEL`; the `pl-12` is the button size plus gap, defined only there). `TablePagination`
(so every `DataTable` page) and the hand-rolled footers of Downloads and Collections use them, so the
count label shifts when the button appears or disappears and is not indented otherwise. The Library's `LibraryPagination`
(grid and folder views, only when its pagination setting is on) renders `TablePagination` too, inside a `pt-2` wrapper
because the Library page scrolls as a whole; the list view is a `DataTable` and has the footer itself. Needs `:has()` (Chromium 105+,
Safari 15.4+, Firefox 121+), which covers the web UI and the desktop webviews; older engines just get no indent.
The variant does not apply inside dialogs or alert dialogs (`&:not([role="dialog"] *, [role="alertdialog"] *)`): they are
portaled above the dock, so a table in a dialog never gets the dock indent.
jsdom can't evaluate `:has`, so tests assert the class strings (and that the dock is `:empty` without a button).

`AppLayout` also mounts a single `RevealAllProvider`, so reveal-all (in-memory only) survives
navigation between Library, Compare list, Downloads and Collections pages; those pages no longer create their
own provider. The shared provider (`clearOnNavigate`) clears individually revealed items when the matched route changes (moving to a
different page); moving between items of the same page (`/library/1` -> `/library/2`, e.g. the "More from this
collection" strip), query-string changes and the Library view mode keep them, and reveal-all persists. It keys on
`useMatches()`, so it needs a data router (the app's `createBrowserRouter`). Browse and the compare player still use their own per-page providers and have no dock. `LibraryItemPage` also owns a
provider (no `clearOnNavigate`, like Browse), so it is unaffected by the shared reveal-all state: a private item always
opens locked, its reveals survive strip navigation (same route) and die with the page, and it renders no reveal action.
It reads the shared context *above* its own provider (a component under the nested one only sees the nested state)
and calls `hideAll()` from a mount-only effect, so opening the page switches the shared reveal-all off.
The provider's reveal set is keyed by plain numbers: library item ids (positive integers), Browse show tiles
(negated collection ids) and Downloads rows, which use `downloadRevealKey(id)` in `lib/revealKeys.ts`
(`id + 0.5`, never an integer, so it can't collide with either) and the Collections info panel's cover, which
uses `collectionRevealKey(id)` (`id + 0.25`, a non-integer that never ends in .5, so it is distinct from all three),
and the Artists image panel, which uses `artistRevealKey(id)` (`id + 0.75`, likewise distinct), one key shared by all of
that artist's panel images.
Both panels are a single focused view, so they drop their key (`hideItem(key)` from an effect cleanup) when the selection
changes or the panel closes; reveal-all is unaffected.
`useHasPrivateContent` (the one rule behind the floating button) also counts any artist with `isPrivate`.
The panel blurs on `effectiveIsPrivate` and finds the "Inherited from …" ancestor with `nearestPrivateAncestor`
(`lib/collectionTree.ts`).

## Resizable side panel (`CollapsiblePanel`)

The Artists and Collections right-hand panels share `CollapsiblePanel`. From `md` up its left edge is a drag/keyboard
handle. The width is a **pixel value the user chose**, remembered per page in localStorage (`usePersistedWidth`;
keys `packrat:artists-panel-width` / `packrat:collections-panel-width`; written when a drag ends and on each keyboard
change, invalid stored values ignored). Reset (double-click / Enter) **removes the key** (`set(null)`) rather
than persisting the default, so the panel follows `defaultWidth` again, including a future change to it. Sizing is
configurable via props `minWidth` (280px), `maxRatio` (0.5 of the row) and `defaultWidth` (500px). The width is
clamped to `minWidth..maxRatio × row` (the minimum wins if it exceeds the share; the default is clamped too) only **at render time**, so the
stored value is never overwritten by the clamp: shrinking the window narrows the panel, growing it restores the
remembered width. The 50% is resolved by measuring the flex row with a `ResizeObserver` (a percentage inside the
animating wrapper would resolve against the wrong box) and exposing the pixels as `--panel-w`; below `md` the classes
ignore it and keep the fixed `w-80`. The slide animation and fixed-width inner container are unchanged; the width
transition is switched off only while dragging.

## List tables (`DataTable`)

`components/data-table/` is the shared list-table component; `TagsPage` is the reference migration and `ArtistsPage` (the table beside its `CollapsiblePanel`, passing
`className="overflow-hidden"`) is on it too, as is `SubscriptionsPage` — the reference for **interactive cells** (a `Switch` and a
hover-popover button inside rows) and for the **stable-handler rule** below. `ThumbnailEnhancementPage` (AI Enhancement history) is the
reference for **controlled (server-side) mode**: the server filters and pages, so the page owns the search / filter / page
state, feeds `rows` (the current page) and `pagination`, and clears its own selection when any of them changes, while
`DataTable` debounces the search box and renders the footer. `HistoryPage`, `LogsPage` (a page-owned status Select next to the
table's own search, via `resetKey`) and `FrameMatchingPage` (no search at all) are client-mode pages as well. The Backup page's
`BackupHistoryTable` is the reference for a table **embedded in a card** rather than filling a page column: controlled mode with
no `pagination` or `search`, `className="gap-4"` (tailwind-merge lets it beat the default `gap-6`) and a `containerClassName` equal
to the plain `Table` default (`relative w-full overflow-x-auto`, no border, no `h-full`) so the card keeps its height; the
toolbar is the `toolbar` slot and the context menu is built from the rows it was opened on (file actions only for one backup that has a file).
The Settings cards follow the same recipe with no toolbar at all: `SessionsCard` and `ServersSection` pass `className="gap-0"`
and the card's own `containerClassName="relative max-h-80 w-full overflow-auto"` (controlled mode, `selection="none"`), keep the surrounding
buttons outside the table, and list the cell dependencies (`isPending`, the active profile id) in the `columns` memo; `ServersSection`'s
`empty` node replaces the whole table, header included. **Dialogs**: `EligibleItemsDialog` (controlled, all rows on one page via a single-page `pagination` config so the footer shows "N items · M selected"),
`KnownItemsDialog` (client mode, 20 per page, `resetKey` = the subscription id) and `StrayFilesRow` (client mode, 50 per page,
`resetKey` bumped by every scan) put the table in the dialog with `className="gap-4"` (the dialog's own
spacing instead of `gap-6`), the action buttons in the `toolbar` slot and the bordered box in `regionClassName`: a fixed
`h-[60vh] flex-none overflow-hidden rounded-md border` (Known items, so the dialog never resizes between loading / empty /
loaded) or a capped `flex max-h-[60vh] flex-col overflow-hidden rounded-md border` (Eligible) with `containerClassName="min-h-0 flex-1
overflow-auto"`, and the skeletons come from `loadingContent`. A box whose parent has no definite height (the Stray files
dialog, only a `max-h`) must be a flex column all the way down (`min-h-0 flex-1` at every level) because `h-full` would resolve to
`auto` there and the table would be clipped instead of scrolling.
**The component owns**
the table chrome and the interaction logic that used to be copy-pasted per page: the column model, alignment, widths and
scroll, the checkbox/radio column, click / ctrl / shift / drag selection (`useTableSelection`, on top of a *controlled*
`useIdSelection` the page passes as `selectionState`, so its toolbar reads the same state), the context menu (including
the Radix remount-key workaround), the debounced search box, the pagination footer (`TablePagination`), and the
loading / error / empty states. **The page owns** the data: fetching, filtering, slicing the current page (`rows` is only
the visible page), resetting the page/selection when the search changes, and what the actions do. It is generic over the
row type and the id type (number or string).

- **Columns** (`ColumnDef<T>`): `key`, `header`, `cell(row)` (any React), `type` (text/number/date/status/icon/switch),
  optional `align`, `width`, `minWidth`, `flex`, `wrap`, `tooltip`, `tooltipText`, `headerClassName`, `cellClassName`. The `type` presets enforce the repo's
  alignment rule for header and cells alike: date/status/switch/icon centre, number right, text left; `align` overrides.
  `icon` cells are wrapped in a flex box so bare (display:block) SVGs centre without `mx-auto`.
- **Selection** (`"multi" | "single" | "none"`): the selection column is generated (default 32px, `selectionColumn` to
  tweak). `multi` = checkboxes + select-all, plain click selects one row, ctrl/cmd toggles, shift ranges, mouse-drag ranges
  (window-level mouseup). `single` = radios inside a `radiogroup` wrapping the content region, a click selects only that
  row, no drag/shift/ctrl. Right-clicking an unselected row replaces the selection with it; right-clicking a selected
  row keeps a multi-selection; the header/empty area opens nothing.
  **`isRowSelectable?: (row) => boolean`** (default: all rows): a row that returns false keeps its place but cannot be
  selected (Import: files already imported). Its checkbox / radio is disabled; the row gets no mouse-down / mouse-enter
  handlers, so a click, ctrl/cmd click or a press that would start a drag does nothing, and `rangeIds` (shift ranges and drags)
  filters it out, so a range across it selects the selectable rows around it. Select-all, the header checkbox's checked /
  indeterminate state, the footer's "· N selected" and the toolbar slot's `selectedRows` consider only the selectable rows of
  the page (a stale selected id of a row that became unselectable is not drawn as selected and not counted). A right-click on
  it leaves the selection alone and the context menu acts on that row only. `onRowClick` / `onRowDoubleClick` still fire. The
  flag reaches the memoized row as the primitive `canSelect`, so a page's inline predicate re-renders only rows whose result
  changed. Dimming it is the page's job (`rowClassName`).
- **Interactive cells**: a mouse-down / click / double-click on `button, a[href], input, select, textarea, label`,
  the `switch`/`checkbox`/`radio`/`combobox`/`menuitem` roles or anything inside `[data-no-row-select]`
  (`INTERACTIVE_SELECTOR`) is left to that element: it doesn't select the row, start a drag or fire
  `onRowClick`/`onRowDoubleClick`. Put `data-no-row-select` on a custom interactive cell that matches none of those.
  Events that reach the row through a React portal (a popover or dialog rendered from a cell) are ignored too. The
  context-menu handler is unaffected.
- **Per-row editable state** (reference: `ImportPage`): a cell that holds an input must not make the page re-render per keystroke,
  and `columns` must not close over changing state (it would re-render every row). The pattern: the page keeps a **ref map**
  keyed by row id (`useState(() => new Map())`, never changed through a setter) and the input is a small cell component that
  keeps its text in its own `useState`, initialised from the map and writing every change back to it. Typing re-renders that
  input only, the text survives the row unmounting (paging, sorting, hiding) because the next mount reads the map again, and
  the page's action (`importOne`) reads the value from the map. The flags that do change on events (Importing / Imported) and
  the page's handler (wrapped in `useEvent`) reach the cells through a small **context** whose value is memoized on those
  flags, so only the cells that consume it re-render, on import events and never while typing; `columns` is a module-level
  constant. `ImportPage.table.test.tsx` pins it with render counters (the page, a row's cells, each input).
- **Rendering cost**: rows are `React.memo`'d (`DataTableRow`) and take only primitives and stable handlers (the
  page's `onRowClick`, `contextMenu` etc. go through `useEvent`, so inline lambdas are fine), so a click or drag
  re-renders only the rows whose `selected` flag changed; a drag that doesn't change the range skips the update
  entirely. **Pages must `useMemo` their `columns`** (deps = whatever the cells close over) or define them at module
  level: a new array identity re-renders every row and cell on every page render. The context-menu items are built
  lazily, only while the menu is open, so the `contextMenu` builder may do real work. **Stable-handler rule**: a cell must
  not read changing page state through a closure — the memoized `columns` would keep serving the old value. Route what a
  cell calls through a handler with a stable identity and list exactly that handler in the `useMemo` deps
  (`SubscriptionsPage`: `toggleEnabled` is a `useCallback` over the update mutation's `mutate`, which TanStack Query v5
  keeps stable; if a callback can't be made stable, go through a ref / `useEvent`). `SubscriptionsPage.table.test.tsx`
  has a test that the Enabled switch calls the *current* mutation after a re-render.
- **Widths**: every column has a width, `width ?? DEFAULT_WIDTH_BY_TYPE[type ?? "text"]` (text 200, number 110, date 180, status
  130, icon 64, switch 96 px; the selection column stays 32), never below its `minWidth` (default 48). **Every** table is
  `table-layout: fixed` with a `<colgroup>` giving each real column its exact width, `width: 100%` and a `min-width` equal to the
  sum of the columns (+ selection column), so a container narrower than the sum scrolls horizontally inside the single scroll
  container (the sticky header scrolls with it). There is no auto layout and no "last column absorbs the slack" any more.
  **Filler column**: when no column is `flex`, `DataTable` appends an empty, `aria-hidden` column (a `<col>` without width, a
  `<th>` and a `<td>` per row with no padding) that takes all the spare width, so the real columns keep their exact widths while
  row borders, the hover / selected highlight and the header background still span the table; it is 0 wide when the columns
  already fill the container. It is not selectable, sortable, hideable or tooltipped, and a click on it is a click on the row.
  **`flex: true`** is an explicit opt-in: such a column gets no colgroup width, its width is only its minimum in the sum, it
  absorbs the spare width and the table then has no filler. The flex columns have no colgroup width, so several of them split the
  spare width **equally**, not in proportion to their `width`; a flex column's `width` counts toward the table's minimum width
  (when the columns do not fit the container the table scrolls) but is only guaranteed as a floor when it is the table's single
  flex column, so use **one flex column per table**. Tables with `flex` today: Sessions (Device), Backup history (Contents),
  Logs (Title, `width: 280`), History (Title, `width: 280`) and AI Enhancement history (Item, `width: 200`). **Clipping**: header and body cells are
  `overflow-hidden text-ellipsis whitespace-nowrap` (a sortable header truncates its label and keeps the arrow), so width comes
  from the column, never from `max-w-*` / `w-*` hints inside cells (an inner `<p className="truncate">` is fine). `wrap: true`
  lets one column's cells wrap onto several lines instead (the row grows; long words break) and gives it no tooltip.
- **Overflow tooltip** (`useOverflowTooltip`): one tooltip per table, not per cell. A delegated `pointerover` listener on the
  body finds the cell under the pointer (cells carry `data-col`), and only on entering it checks whether the text is cut off
  (`scrollWidth > clientWidth` on the cell **or** any descendant, since many cells truncate in an inner block); then, after the
  app's usual tooltip delay (200 ms), it shows the existing `Tooltip` with the cell's `innerText` (two-line cells stay two
  lines) or `tooltipText(row)`. The anchor is a fixed, pointer-less box over the cell portaled to `document.body` (a dialog's
  transform would otherwise displace it). Never for the selection column, `icon` / `switch` columns, the filler, `wrap`
  columns or `tooltip: false` columns. **Controls in the cell**: a cell that also holds a control (`TOOLTIP_BLOCKING_SELECTOR`:
  button, input, select, textarea, label, the switch / checkbox / radio / combobox / menuitem roles, `[data-no-row-select]`;
  plain links are not controls) still shows the tooltip, but not while the pointer is over a control or inside one: the
  hook remembers whether the pointer is on a control as well as which cell it is in, so moving from the text onto a button
  closes it, moving back measures again, and moving between two controls does nothing. The text is the cell's own text
  **without the text of its controls** (`textOutsideControls`: a tree walk over the text nodes, skipping control subtrees,
  SVGs and `display: none`, one line per block ancestor and per `<br>`, whitespace collapsed; it replaces `innerText`, which
  cannot leave anything out and does not exist in jsdom), so a button label never ends up in the tooltip, and a cell with only
  controls shows none. A long value inside a control (an input) does not make the cell count as cut off. `tooltipText(row)` still
  replaces the computed text. It closes on mouse down (and stays
  off until the button is released, so drag selection is quiet), scroll, context menu, Escape and pointer leave, and never stops
  or alters an event, so selection, drags, shift/ctrl clicks and the context menu are untouched. Keyboard-only use is not covered.
  **Headers** use the same hook: the listener is also on the `thead` and finds `th[data-col]` (the selection column and the filler
  have none), with the same rules (cut off, `tooltip: false`, no icon / switch / `wrap`) and the header's own text. The label inside
  a sortable header's button counts as cut off, and that button (`data-sort-button`) is the one control that is part of the label
  rather than a control (any other control in a header follows the rule above). Hovering the resize handle shows none.
- **Scroll reset**: when the page (`pagination.page` in controlled mode), the effective sort, the search query (the table's own in
  client mode, the value `search.onChange` last reported in controlled mode) or `resetKey` changes, `DataTableView` sets the
  scroll container's `scrollTop` to 0 (found through a ref on the region wrapper, `[data-slot=table-container]`) in a layout
  effect that compares those values on every render (no extra render, never on mount). A refetch, a selection change, a hidden
  column or a resize are not in the key, and `scrollLeft` is never touched.
- **Footer**: always shown when pagination is configured (client mode with `pageSize` + `itemLabel`, or the `pagination`
  prop), including while loading and on error, so the page (and a dialog) never changes height between states. Then it shows
  a placeholder ("—" instead of the count, no "· N selected", Previous/Next and the current page button disabled) and
  `TablePagination` skips its clamp (`loading` prop), otherwise a table on page 3 would snap to page 1 while its total is 0.
  A single page or an empty table shows "0 tags" and one disabled page. In `multi` mode it appends "· N selected" (selected rows on the current page); **`selectedCount?: number`** replaces that number (0 shows nothing) for a page whose selection spans more than the rows shown and has its own count (the Library list view passes the toolbar's). `TablePagination`
  clamps itself: if `page` exceeds the page count (e.g. the last row of the last page was deleted) it calls
  `onPageChange(lastPage)`, so pages need no clamping code. **Dock clearance is automatic**: the footer
  carries the `dock-occupied:` variants of the clearance classes (`lib/dockClearance.ts`: row `flex-wrap-reverse gap-2`,
  label `flex min-h-9 items-center pl-12`, `md:min-h-0` from `md` up), so it indents the count and lets the pager wrap above
  it only while the floating dock holds a button (see "Dock-aware footers" under Floating action dock); no page passes a prop.
- **Columns and layout** (opt-in per column): `hideable` (default false), `defaultVisible` (default true) and `label` (name in
  the menu; falls back to a string `header`, a dev warning otherwise). A table with a hideable column gets an icon-only
  **Columns** menu at the right end of the toolbar (order: filters, search, Columns, Layout; the first of them takes the
  `ml-auto`), and with a `tableId` also the **Layout** popover (see "Saved table layouts" under Auth; it is also shown for
  sortable columns, see Sorting below). Hidden columns leave
  the header, the cells and the colgroup, and the widths (and the min-width sum) are computed from the visible columns; the visible
  list is memoized on the *content* of the hidden set (and is `columns` itself when nothing is hidden), so a toggle re-renders
  the rows once and nothing else does. Non-hideable columns are never hidden, even if a saved layout lists them. A page can
  own the working layout with `layout` + `onLayoutChange`. Tables without a hideable column render exactly as before.
- **Client-side mode**: for pages whose data is fully loaded, pass **all** rows plus `pageSize`, `itemLabel` and/or
  `search.match(row, query)` and the table does what the page used to: it owns the query and page state, filters
  (the query is trimmed and lowercased once; an empty query means no filter), slices the current page, resets to
  page 1 when the query changes, clears the selection on a page or query change (selection is scoped to what's
  visible), and feeds the footer (total = filtered count; the clamp above covers a shrinking list). `empty` may be a
  function of the query (as typed) to tell "nothing yet" from "no match"; the toolbar slots also get `query` and
  `total`. **`match` must have a stable identity** (module-level function or `useCallback`), or the filter memo
  re-runs every render. **`resetKey`** is for a filter the page applies to `rows` itself (Logs' status Select): when its
  value changes (`Object.is`) the table goes back to page 1 and clears the selection, exactly as for its own search. The page
  reset is a state adjustment during render (no extra commit); the selection (the page's, via `selectionState`) is cleared in
  a layout effect, because updating another component while rendering is not allowed. An unchanged key does nothing.
  **`PaginationConfig.hidePages`** renders the footer count-only (no Previous / Next / page buttons, no clamping, no `onPageChange`; dock clearance and the loading placeholder stay). **Context menu**: `ContextMenuItemDef` has a submenu variant (`{ key, label, icon?, disabled?, items }`, rendered with the shadcn `ContextMenuSub*`; nested items receive the same rows, separators / destructive / disabled work as at the top level), and the page's `contextMenu` builder now runs when the menu is requested (the right-click), so returning an **empty list opens no menu at all** (the default is prevented, the browser's own menu does not show either, like the header). **`layoutActions?: ReactNode`** adds controls at the end of the toolbar's button group, after Columns and Layout (the Library list's display settings
  cog); it counts as a toolbar element, so the group shows and right-aligns even when nothing else does. **`defaultHiddenWhenUnset`** (with a `tableId`) makes a stored layout
  without `hidden` hide the `defaultVisible: false` columns. Server-paged pages keep the controlled mode (`rows` = the current page, `pagination` and
  `search.onChange` owned by the page; `search.value` is optional, it only seeds the input). In controlled mode the
  table does **not** reset the page or the selection: the page does both in its handlers/effects (AI Enhancement: `search.onChange`
  sets the query and page 1, each filter `onValueChange` sets page 1, and an effect clears the selection on a page / search /
  filter change). `empty` should be a node there (the function form only receives the seed `search.value`, not the page's query); the two modes are selected by whether `pageSize`/`match` is given.
- **Layout**: the component renders a `flex min-h-0 flex-1 flex-col gap-6` block (toolbar and footer `shrink-0`, only the
  content region scrolls), meant to sit under the page title in the usual page column.
- **Region props** (for tables inside a dialog or card): `regionClassName` is merged onto the content region wrapper
  (`min-h-0 flex-1`) that holds the loading / error / empty state or the table, so one fixed or capped height and
  border covers all of them and the box doesn't resize between states; `loadingContent` replaces the default skeleton
  bars while `loading`.
- **Sorting** (opt-in per column): a column is sortable when it declares `sortValue(row)` (string | number | boolean | Date |
  null | undefined; cells are React nodes, so the value is given explicitly). The comparator (`sorting.ts`) orders strings with a
  case-insensitive, numeric-aware `Intl.Collator`, numbers numerically, Dates and booleans by their numeric value; null, undefined,
  NaN and an invalid Date come **last in both directions**; ties keep the original row order. **Where it runs**: only in
  client-side mode (`pageSize` / `search.match`), on the filtered rows *before* paging, so shift-range and drag selection follow
  the displayed order. In controlled (server) mode the table never sorts rows: the page owns `layout` / `onLayoutChange`, reads
  `layout.sort` (or its own default) and sorts on the server; the header still shows the arrow and reports clicks through
  `onLayoutChange`. **State**: the sort lives in the layout (`layout.sort`, absent = none), so it is a working draft exactly like
  hidden columns: applied instantly, never saved automatically, reset to the baseline on leaving the page, and covered by Save /
  Restore / Clear and the dirty dot. **Default sort**: `defaultSort` is the table's natural order, to be set only where it
  reproduces the order of `rows` exactly (History and Logs: date desc = the API's `created_at DESC`; Artists is *not* set because
  the API orders by name with SQLite's binary collation, which differs from the collator for mixed case; Subscriptions is not set
  because no column shows `created_at`). The effective sort is `working.sort ?? defaultSort ?? none`, and the header shows its
  arrow. **Cycle** (`nextSort`): none or another column → asc; asc → desc; desc → cleared (back to the default / natural order);
  if clearing would change nothing (the column is a desc default) it moves on to asc instead, so a table without a default cycles
  asc → desc → off, a default column toggles between its two directions and any other column cycles asc → desc → default.
  An explicit sort equal to the default is stored as no sort. **Normalization** (`normalizeTableLayout`): a `sort` is dropped
  when equal to `defaultSort` or when its column is not sortable / does not exist, so a saved layout without `sort` means "default
  order" and layouts saved before sorting existed keep working. **`extraSortKeys?: string[]`** lists sort keys that are valid in the layout
  without being columns (a server sort the page offers elsewhere, e.g. the Library's `filename` and `sequenceNumber`): with a `tableId` they are added to
  the known and sortable keys fed to normalization, so a layout sorted by one is kept, is dirty against another sort and is saved; no header shows an arrow
  and nothing is sorted by it (a controlled table never sorts anyway), and the next header click moves on to that column ascending. **Header**: a sortable header is a `button type="button"` inside the
  `th` (with `aria-sort`), drawn like the Library list: an `ArrowUp` / `ArrowDown` (`h-3 w-3`) after the label, before it in
  right-aligned columns so the label stays flush right, and centered columns keep a spacer of the arrow's width on the other
  side so the label stays centered. A sort change, however it came about (click, Restore, Clear, a saved layout arriving), goes
  back to page 1 and clears the selection in client mode, with the same mechanism as `resetKey` (state adjustment during render +
  layout effect), keyed on the effective sort. **Layout button rule**: a table with a `tableId` and at least one hideable, sortable *or* resizable
  column gets the Layout popover; the Columns menu needs a hideable one; the `ButtonGroup` holds whichever apply
  (History: Layout only). Tables with neither render exactly as before. A sorted column that is also hidden keeps sorting.
- **Resizing**: every column of a table **with a `tableId`** is resizable except the selection column, the filler, a `flex`
  column (it absorbs the spare space, so dragging would show nothing), and `icon` / `switch` columns; `ColumnDef.resizable`
  overrides the default either way (`true` on a flex column only moves its floor). Tables without a `tableId` (dialogs, Settings
  tabs) get no handles. The handle is a `role="separator"` zone (`ResizeHandle`, `aria-label` "Resize <column> column", not focusable,
  no keyboard or double-click reset: Restore / Clear are the way back) on the right edge of the `th`, a **sibling** of the sort
  button so pressing it never sorts, drawn as a 1 px line only while the header is hovered. `useColumnResize` is modelled on
  `CollapsiblePanel`: pointer events with pointer capture (the drag ends wherever the button is released), `preventDefault` on the
  press (no text selection), `col-resize` and `user-select: none` on the body until it ends (also on pointercancel, lost capture and
  unmount). **Live vs committed**: while dragging only `DataTableView` holds the width (a `{key, width}` state fed into
  `computeLayout`, so the header, the colgroup and the min-width follow); the memoized rows receive nothing new and do not
  re-render. On release the width goes into the working layout (`layout.widths[key]`, removed when equal to the default) like a hidden
  column or the sort: dirty dot, Save, Restore, Clear. Growing a column uses up the filler first, then the table outgrows the
  container and the single scroll container scrolls sideways (the sticky header with it). Effective width =
  `max(widths[key] ?? width ?? type default, minWidth ?? 48)`, capped at 2000 (`effectiveColumnWidth`).
- **tableIds** (stable, kebab-case): `artists`, `subscriptions`, `history`, `logs`, `tags`, `ai-enhancement`, `frame-matching`,
  `backup-history`, `import`, `library` (the list view; shares its layout with the Library sort). Dialog tables (Eligible items, Known items, Stray files) and Settings tab tables (Sessions, Servers) have none.
- **Why no virtualization**: pages are paginated at 50 rows, so virtualization would add complexity for no gain.
- **Why Collections doesn't use it**: it renders a tree (expand/collapse, nesting, drag to re-parent), which a flat
  row model doesn't fit; its cells could use the same primitives but the table itself stays bespoke.

## Deliberate scope cuts

Still intentionally out of scope, not forgotten:

- **No conditional logic in filename templates.** Templates (`{artist}/{title}`, see
  `internal/nametemplate`) only substitute `{variable}` tokens and split on `/`; there is no "drop
  this segment if `{sequence}` is blank". A blank filename and template uses yt-dlp's native
  `%(title)s`; a literal filename is used as given (sanitized).
- **No multi-user support.** One user account, created once via the setup wizard; there is no
  invite/second-account flow, and `POST /api/auth/setup` permanently 409s after the first user
  exists. (`user_preferences` is already user-scoped, so a future multi-user change won't need to
  rework it.)
- **No permanent lockouts or distributed rate limiting.** Failed logins are throttled (see "Login
  throttling" above) but only ever delayed, in memory per process; there is no account lock and no
  shared store. WebSocket has no origin restriction (`CheckOrigin` always returns true) beyond the
  session-cookie gate.
- **No automatic media byte transfer in backups.** By design — see "Backup and restore" above.
  A library bundle is a recipe for re-downloading, not an archive of the files themselves.
- **No image galleries/site scraping.** `downloadType=image` is deliberately scoped to one direct
  link → one file, no `gallery-dl`-style multi-image-per-post extraction. Ghost items and
  subscriptions also don't gain image support — both stay `video`|`audio`-only by design, even
  though `Collection.defaultDownloadType` itself now also accepts `image`.
