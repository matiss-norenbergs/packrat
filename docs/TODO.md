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
- **Failed-attempts notice edge (S).** The "failed attempts since last login" notice compares timestamps
  at one-second resolution with a strict `>`, so failures in the same second as the last
  acknowledgement aren't counted. Harmless in real use.

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

## Web app polish

- **Console noise (S).** Every page logs a React error about a `<script>` tag rendered inside a
  component, a React Router `HydrateFallback` warning, and a WebSocket "closed before the connection was
  established" warning in dev. A permanently noisy console hides real errors.
- **Edit Sequence dialog (S).** The left panel's 40% minimum can't be reached because the right panel's
  50% maximum limits it first (that was already the case before the library upgrade); one of the two
  limits is pointless.
- **Image loading (S to M).** From [`live-image-resize.md`](live-image-resize.md): tiles and the cover
  picker already use lazy loading and live resizing. What's left: the Frame Matching review page still loads
  full-size reference/found frames, and the resized-image cache has no size cap (age-based eviction only; a cap
  with LRU eviction is the possible next step if it grows large). The artist image picker was left alone on purpose.

## Backups

- **Artist privacy, birthday and images in backups (S to M).** Library backups only carry artist *names*
  (the bundle's `artists` list is plain strings), so a restore loses the artist private flag, birthday and images.
  Carrying the flag needs an object form for that list with a backward-compatible import (old bundles with bare
  strings must keep importing).

## Backend audit leftovers

From the full backend audit: every numbered finding is fixed. What follows is its "low confidence" list
(real but unlikely to matter, or needing a decision), plus a few loose ends found while fixing the rest.
None are scheduled. Sizes are guesses.

**Could show wrong data**

- **Collection PATCH is a full replace (S).** Omitted `isPrivate`, `browseAsShow` and `artistId` are cleared
  instead of left alone. Decide whether PATCH should merge, then make it so (and update `api.md`).
- **Ghost create keeps the row on a tagging failure (S).** It answers 500 but the ghost stays, so a retry makes a
  second ghost. Create and tag in one transaction, or delete the row on failure.
- **Duration stored as 0 after a trim when ffprobe fails (S).** It should be NULL so the UI shows "unknown".
- **Double redownload race (S).** The active-download check and the enqueue are not atomic, so two quick
  redownloads of one item can both queue.
- **Unvalidated thumbnail bytes in `SetLibraryThumbnail` (S).** Any bytes are written as the sidecar. Decode with
  `thumbwrite.Probe` first (JPEG/PNG), as the other thumbnail writers now do.
- **Gallery extension (S).** `readCurrentThumbnail` labels every thumbnail `.jpg`, whatever the real format.
- **Trim preview not bound to an item (S).** `trim_handler.go`: accept takes any valid `.trim-preview-*` path, not
  just the one created for that item.
- **Collection path segments from an uploaded bundle are not sanitized (S).** `..` or `a/b` in a name. Downloads
  stay contained by `pathsafe`, but the segment should be cleaned on import.
- **Restore bypasses settings validation (S to M).** Values are written verbatim (only `maxConcurrentDownloads` is
  clamped now). Run the same validation as `PATCH /api/settings`, clamping or skipping bad values instead of failing.

**Behavior to decide or finish**

- **Collection `rootPath` change moves nothing on disk (S).** `FEATURES.md` doesn't say whether that is intended.
- **A restore that re-enables subscriptions doesn't run the catch-up check (S)** that `UpdateSettings` runs.
- **Subscription tags are comma-joined (S).** A tag containing `,` splits in two.
- **"Current" playlist mode on a pure playlist URL (M).** It downloads every entry but only the last becomes an item.
- **Serial bulk thumbnail fetch (S).** One yt-dlp run per id inside the request, with no cap or dedupe.
- **`ScanImport` runs one ffprobe per untracked file inside the request (M).** Move it to a background job with
  progress, like the other scans.
- **Backfill progress shows 0 during the library pass (S).**
- **No per-click cancel for an AI enhancement (S).** The goroutines are tracked and stop on shutdown, but a single
  Enhance or Sharpen can't be cancelled.
- **N+1 queries in the subscriptions list and bulk frame match (S).** Only visible at large sizes.

**Small hardening**

- **Logout has no CSRF check (S).** `SameSite=Lax` makes it a nuisance at most.
- **WebSocket has no `SetReadLimit`, and at shutdown each `readPump` blocks on `unregister` (S).**
- **`pathsafe` does not resolve symlinks (S).** Exploiting it needs host access.
- **Jellyfin item id is not escaped in the URL path (S).** It is an admin-set value.
- **`%` in output names (S).** A remote title with `%(...)s` is expanded by yt-dlp. Paths stay contained.
- **`synchronous=FULL` under WAL (S).** `NORMAL` is the usual setting and is safe with WAL; a durability trade to decide.
- **The FTS `library_au` trigger has no column list (S).** Every playback-position heartbeat rewrites the FTS row
  (about 3 ms). Restrict it to the indexed columns.
- **A1111 output writes PNG bytes into a `.jpg` sidecar (S).** Check whether consumers (Jellyfin, the frontend)
  sniff the content or trust the extension.
- **`pruneEmptyParents` can race tier generation for the same directory (S).** A tiny window.
- **Case-sensitive stray-file matching and Windows reserved names (S).** `SanitizeFilename` doesn't reject `CON`,
  `NUL`, `COM1`. Windows hosts only.

**Loose ends**

- **Run `govulncheck` (S).** It has never run: the vulnerability database download was blocked in the audit
  sandbox, so dependency CVEs are unchecked. Try it from a normal network, or add it as a CI job.
- **Backup upload UI size check (S).** The server accepts 128 MB on the backup import routes (the global body limit
  stays 50 MB). Check whether the upload dialog has its own client-side limit and raise it to match.
- **Trim UI frame cap (S).** `ExtractFrameRange` stops at 300 frames (`maxFrameCount` in
  `downloader/trim_frames.go`), so a very long range is cut off.
- **CI step timeouts (S).** The `desktop` and `e2e` jobs have hung for hours on the "Install Linux dependencies"
  step (an `apt` stall, not a code problem), and only a manual re-run recovered. A `timeout-minutes` on those jobs
  (and a retry around `apt-get update`) would make a hang fail in minutes.
- **Slow arm64 release build.** The release workflow builds the arm64 Docker image under QEMU, which is slow.
  Decided to do nothing for now; a native arm64 runner is the fix if it starts to matter.

## Dependencies

- **Node 22 to the next LTS (S).** Moved by hand across the Dockerfile and the three workflows (Dependabot
  ignores Node major versions on purpose). Do it when 22 nears end of life.
