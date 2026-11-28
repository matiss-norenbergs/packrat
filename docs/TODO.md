# To do (maybe, someday)

Ideas and loose ends that are **not** planned for any release. Nothing here is promised; it's a
parking lot so they aren't forgotten. Things that were ruled out on purpose live in
[`architecture.md` → Deliberate scope cuts](architecture.md#deliberate-scope-cuts); the manual Windows
test items that haven't been run live in [`../desktop/TESTING.md`](../desktop/TESTING.md).

Effort is a rough guess: **S** = under an hour of agent work, **M** = a few hours, **L** = a project.

## Security hardening

- **Short-lived media tokens (L).** The desktop app puts its real session token in `?token=` on media
  and WebSocket URLs (`<img>`, `<video>`, `/ws` can't send headers). Anyone who sees such a URL gets
  the whole login. Plan: `POST /api/auth/media-token` returns a separate token that works only for
  `GET`/`HEAD` on media routes and `/ws`, tied to the session (revoking the session kills it),
  stateless (HMAC with the existing server secret key), about 2 h long, refreshed hourly.
  - Hard part: URLs embed the token, so a rotation changes every URL (thumbnails reload) and a video
    open past expiry fails on its next range request, so the frontend needs one URL-building place that
    recovers from a 401 by fetching a fresh token and retrying.
  - Compatibility: the first server release must accept both token forms (older desktop apps only know
    the query session token); a follow-up release removes the old form.
  - Worth doing mainly if the server is ever reachable beyond a private network (Tailscale/LAN).
- **App-wide Content-Security-Policy (M).** The SPA (web) sends no CSP today. The desktop's
  `tauri.conf.json` already runs `script-src 'self'; style-src 'self' 'unsafe-inline'; ...` for the same
  frontend and `index.html` has no inline script, so a web CSP is feasible. Plan: reuse the desktop policy,
  ship it first as `Content-Security-Policy-Report-Only`, load every page in a real browser and check the
  console, then enforce.
  - Watch: Safari's WebSocket handling under `connect-src 'self'`, remote thumbnails needing
    `img-src http: https:` (until audit finding S2-02 is fixed), injected styles, and the Vite dev server.
  - Deferred because there is no known injection point today, so it is defense in depth, and a policy
    that is too tight breaks things silently. The served-file routes already have their own CSP, see
    [`architecture.md` → Served files](architecture.md#served-files).
- **Failed-attempts notice edge (S).** The "failed attempts since last login" notice compares timestamps
  at one-second resolution with a strict `>`, so failures in the same second as the last
  acknowledgement aren't counted. Harmless in real use.

## Large libraries

- **Virtualized grid and DataTable (L).** Pagination defaults to off, so the Library grid, Folders view and list
  view render every item: about 2 s at 3,000 items and about 10 s at 10,000, with select/clear about 0.4 s,
  even after the grid render-cost work (see [`architecture.md` → List tables](architecture.md#list-tables-datatable); the grid and the list are windowed now). With pagination on, 10,000 items show in well under a second, so this only matters for
  very large libraries kept on one page. Plan, in order, one PR each:
  1. **Done: `ResponsiveGrid` (`components/responsive-grid/`), no virtualization.** The Library grid and the Folders view
     render it; it owns the scroll region and takes `items`, `getKey`, `renderItem`, column presets, `resetKey` and the
     loading / error / empty slots (see [`architecture.md` → ResponsiveGrid](architecture.md#responsivegrid)). Behavior and
     look unchanged. `LibraryCard` and `LibraryCardsProvider` kept their names and stay Library-side.
  2. **Done: virtualization behind a prop.** `ResponsiveGrid` takes `virtualize` (off by default, a page's choice, never a
     user setting) and a threshold (`VIRTUALIZE_THRESHOLD`, 200 items: at or below it the grid is the plain DOM). On for the
     Library grid and the Folders view: rows of `columns` cells, measured row heights, the column count from `matchMedia`,
     `@tanstack/react-virtual` in its own `vendor-virtual` chunk (see [`architecture.md` → ResponsiveGrid](architecture.md#responsivegrid)).
  3. **Done: the thumbnail gallery uses `ResponsiveGrid`, `virtualize` stays off (measured).** The dialog renders the
     `gallery` preset (2 / 4 / 6 columns) with the skeletons, the two empty messages and a `resetKey` of sort, direction and
     filter; the tile is a memoized `ThumbnailGalleryTile` with stable callbacks, so a selection change re-renders only the
     tiles that changed. Measured in the dev container with galleries of 50 to 1,000 generated 1280x720 JPEGs (ghost items
     filled through `POST /api/library/:id/thumbnail/gallery`), in the browser pane with `performance.now()` + two
     `requestAnimationFrame`s, on a fresh page load per size:

     | Images | Mode | Open to painted grid | DOM nodes | Select all | Clear |
     |---|---|---|---|---|---|
     | 50 | plain | about 0.2 s (0.4 s cold, with the fetch) | 1,032 | 57 ms | 45 ms |
     | 200 | plain (the threshold) | 0.38 s | 4,017 | 83 ms | 76 ms |
     | 500 | plain | 0.76 s | 9,987 | 198 ms | 154 ms |
     | 500 | `virtualize` | about 0.15 s plus the fetch | 1,126 | 52 ms | 49 ms |
     | 1,000 | plain | 1.45 s | 19,937 | 428 ms | 306 ms |
     | 1,000 | `virtualize` | about 0.15 s plus the fetch (0.6 s) | 1,126 | 75 ms | 61 ms |

     Scrolling (a 90-frame programmatic sweep over the whole grid, median frame time): with the images already loaded the
     plain grid at 500 is smooth (7 ms, no frame over 33 ms) and the windowed one is not (25 ms, 10 frames over 33 ms: rows
     are mounted while scrolling); a first sweep is bound by the server resizing and the browser decoding the images, so
     it is slow in both modes (plain 41 ms, windowed 27 ms at 500). **Decision: off.** At 500 images (the most a hand-saved
     gallery plausibly reaches) the dialog opens in under a second and select all is not janky, and windowing makes warm
     scrolling worse. 1,000 images take about 1.5 s to open, which is not a realistic gallery; if one ever matters, add
     `virtualize` to the dialog's grid (ranges and select all work on ids and the viewer indexes the full list, so they should carry over, but
     check shift-click, select all and the viewer's next/prev in the windowed grid, and
     the kept-rows logic) and re-measure.
  4. **Done: an opt-in `virtualize` on DataTable**, switched on for the Library list only. Spacer rows keep the sticky
     header and the column widths, `scrollMargin` is the header's height, the body is lazy-loaded, rows carry
     `aria-rowindex` (see [`architecture.md` → List tables](architecture.md#list-tables-datatable)).
  - Costs accepted for the grid (step 2, done): browser find-in-page no longer finds offscreen items (the Library's own
    search covers it); tab order and screen readers see only the mounted items; the scrollbar can move a little while
    far rows are measured; tests need `src/test/layoutMock.ts`. Step 4 (DataTable) has the same costs, with
    `aria-rowcount` / `aria-rowindex` kept on the real table.

## Desktop app

- **Code signing (M, costs money).** Windows builds are unsigned. Windows Smart App Control can block a
  new unsigned build the first time it's seen (v0.18.0 was blocked on one PC while v0.17.0 and v0.18.1 ran),
  and an in-app update could replace a working install with a blocked one. Signing is the real fix.
  Options to research before spending anything: Microsoft's signing service, a standard code-signing
  certificate from a CA, a free program for open-source projects (each has eligibility and price
  conditions that must be checked at the time). Until then: don't press "Install and restart" on a machine
  where a new build might be blocked.
- **Self-signed HTTPS, "trust this server" (L).** Connect to a server with a self-signed certificate:
  show its fingerprint and expiry, pin that exact certificate per server profile (like SSH known_hosts),
  warn again if it changes. WebView2 can allow a pinned certificate via a browser flag but needs a
  window re-create or relaunch after trusting; Linux and macOS need separate code. Do a short spike on
  Windows first. Alternative with no code: Tailscale gives real, trusted certificates (`tailscale cert` /
  `tailscale serve`).
- **CORS origins editable in Settings (S).** Today `CORS_ALLOWED_ORIGINS` is an environment variable (it
  defaults to the Tauri app origins).
- **"Incognito"-style session (M).** An option to not persist the login token at all (memory only), so
  closing the app signs you out.
- **macOS (L).** The installers build in CI but nothing has been run on a Mac (downloads, notifications,
  window-state, the LaunchAgent for launch at login, the Keychain). Needs a Mac to test.
- **Windows end-to-end automation (M).** The desktop e2e suite (`desktop/e2e`) runs on Linux only. The
  Windows variant (WebView2 + `msedgedriver`, the registry `Run` value instead of the autostart file)
  would go in `desktop/e2e/lib/platform.mjs`.
- **Real keychain in CI (M).** CI has no Secret Service, so only the `localStorage` fallback is exercised.
- **Make `desktop-e2e` a required check (S).** After the job has proven stable over a few weeks, add it to
  branch protection (configured outside the repo).

## Manual Windows checks never run

From the v0.18.1 / v0.18.2 runs of the checklist in `desktop/TESTING.md`: **W-14** (upgrade from a
pre-profiles release), **W-71 to W-73** and the install half of **W-74/W-76** (real in-app updates and
"Match server version"; each installs another build), and **W-21/W-22** done only by simulation (running
the `Run` command; a real sign-out/sign-in of Windows wasn't tested).

## Backend audit leftovers

From the full backend audit: every numbered finding is fixed. What follows is its "low confidence" list
(real but unlikely to matter, or needing a decision), plus a few loose ends found while fixing the rest.
None are scheduled. Sizes are guesses.

**Behavior to decide or finish**

- **The untracked-file scan/import still doesn't know a collection's old folder name (S to M, verified by tests).**
  A library bundle restore now finds a renamed collection by display name and never modifies an existing one, but
  the Import page's untracked-file scan (`CollectionsRepo.EnsureChain` through `api/import_handler.go`) still
  matches by folder name only. Renaming a folder moves nothing on disk, so a tracked item in the old folder is not
  untracked (the scan matches files to rows by stored path, never by folder) and nothing changes for it. An
  *untracked* file in the old folder (copied in by hand, or left by another tool) is offered as "new collection
  `concerts`", and importing it creates a duplicate collection named after the old folder with defaults (not
  private even if the renamed one is) or, when the renamed collection's display name equals the old folder name
  (`Podcasts` / `Podcasts`, renamed to `Pods`), creates it as `Podcasts (2)` (it used to fail with a `500`). Evidence:
  `api/collection_rename_import_test.go` (`TestImportScan_UntrackedFileInOldFolderCreatesDuplicate`,
  `TestImportScan_UntrackedFileInOldFolderNameClash`). Likelihood is low: the redownload bug that left files in the
  old folder is fixed, and downloads, Move and redownload keep rows and files consistent. Fix idea: reuse the
  restore's resolver idea, but a scan has no bundle entry and so no display name to match; the only signals are the
  folder name, so the realistic fix is to refuse or warn ("a collection named `concerts` exists under a different
  folder") instead of creating a duplicate.
- **A stable collection id in library bundles (M, deferred).** Matching by folder, then display name, is a heuristic:
  it can still miss when both were changed since the backup (the bundle then creates a new collection), and an
  ambiguous display name (legacy rows that share one) matches nothing and is reported as unresolved. A
  `collections.uid` column (migration, backfilled), exported on entries and items and matched before the chain,
  would make it exact and survive any rename. Costs: a migration, old bundles still need the name fallback, an id
  carried to another install that renamed things independently has to be handled, and a bundle with the new field
  is only needed by new servers (old servers ignore unknown fields). Only worth it if bundles ever move between
  installs that renamed things independently.
- **Serial bulk thumbnail fetch (S).** One yt-dlp run per id inside the request, with no cap or dedupe.
- **`ScanImport` runs one ffprobe per untracked file inside the request (M).** Move it to a background job with
  progress, like the other scans.
- **Backfill progress shows 0 during the library pass (S).**
- **No per-click cancel for an AI enhancement (S).** The goroutines are tracked and stop on shutdown, but a single
  Enhance or Sharpen can't be cancelled.
- **N+1 queries in the subscriptions list and bulk frame match (S).** Only visible at large sizes.

**Loose ends**

- **Trim frame picker timeout headroom on very heavy windows (S to M).** `ExtractFrameThumbnails` and
  `ExtractFrameRange` share a 30 s `frameRangeTimeout`. A synthetic 4K 120 fps, 15 s window took about 20 s here, of
  which about 15.5 s was ffprobe listing every frame's timestamp (`probeAllFrameTimestamps`, which decodes the
  frames). Slower hardware (a NAS or a Pi, which Packrat targets) could pass 30 s on very heavy windows. Ideas, none
  decided: list timestamps with `-show_packets` instead of decoding, run ffprobe and ffmpeg concurrently, or scale
  the timeout with the window's expected frame count. Unmeasured on slow hardware; not scheduled.

## CI flakes

- **`internal/queue` `TestImageConversionDoesNotOverwriteExistingTarget`: "TempDir RemoveAll cleanup: directory not
  empty" (S).** Seen once in CI, not reproduced. About 420 runs under `-race` (6 parallel processes, `-count=35
  -cpu 1,2`, Linux container) all passed. Nothing in the production queue code starts a goroutine, and `runOne`,
  `imagefetch.Fetch` and `imageproc.ConvertImage` are synchronous, so "work still running after `runOne`" is not
  the cause. Open suspects: SQLite WAL files of `newGhostEnv`'s DB (opened with `synchronous(FULL)`) or an orphaned
  fake-ffmpeg/yt-dlp child on the contended runner. Next step: on the next CI failure, log the leftover entries
  of the directory that failed to delete.
- **CI `desktop` job, "Install Linux dependencies" failed after about 5 minutes (twice).** Not a timeout mismatch:
  `apt-install.sh` worst case is 3 x 150 s + 2 x 10 s pauses + kill grace (about 8.5 min), under the steps'
  `timeout-minutes: 10`. A stop at about 5 minutes means apt itself failed. Needs the job logs to say why.
- **`internal/api` `TestBulkAddSubscriptionEntriesQueuesHundredsInstantly` asserts wall-clock time (S).** Failed once
  in a full `go test -race ./...` in a Docker container on a Windows host ("bulk add of 300 took 5.86s"), passed on
  an isolated re-run (`internal/api` alone, 114 s). Found while verifying, outside the ws/queue scope, not fixed.
  Same family as the other flakes: a timing bound on a contended machine.

## Dependencies

- **Node 22 to the next LTS (S).** Moved by hand across the Dockerfile and the three workflows (Dependabot
  ignores Node major versions on purpose). Do it when 22 nears end of life.
- **Unpin oxlint (M).** `oxlint` is pinned to exactly `1.91.0` in `frontend/package.json` (no caret), and
  `.github/dependabot.yml` ignores newer versions, because 1.95.0 reports 97 warnings against the 76 ratchet
  (21 more: `react/set-state-in-effect` +19 (18 → 37), a new `react/refs` rule +4 (all in
  `components/library/useCompareGroup.ts`), `react/immutability` −2 (9 → 7)). To unpin: fix those warnings,
  lower `--max-warnings` in `frontend/package.json` to the new real count (never raise it), restore the caret
  range, and remove the oxlint `ignore` entry from `dependabot.yml`.

## Frontend tooling

- **`noUncheckedIndexedAccess` outside `src/lib` (M, incremental).** Only the non-test `src/lib` files are
  checked (`tsconfig.lib-strict.json`, `npm run typecheck:lib`). Turning it on for all of `src/` reports about
  487 errors today: 63 in non-test code (DataTable, BulkDownloadDialog, EditSequenceDialog, `player/playerMath.ts`,
  `LibraryListView`, the two slider components, …) and about 424 in tests. Widen the `include` of that tsconfig
  directory by directory as each one is fixed (handle `undefined`, no `!`), tests last.
- **oxlint `--type-aware` (S to enable, M to clear).** Works here with `oxlint-tsgolint` as a dev dependency and
  runs in about 2 s, but adds about 254 warnings on top of the 76 (151 `no-floating-promises`, 72 `unbound-method`,
  18 `no-meaningless-void-operator`, 10 `require-array-sort-compare`, 3 `no-misused-spread`, 1 `await-thenable`),
  which would blow the `--max-warnings` ratchet. Enable it, with the ratchet raised once to the new honest total,
  after the floating promises are triaged (most are `mutate()` calls that are fine to leave unawaited, so
  decide the rule's scope first).
