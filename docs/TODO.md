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

## Backend audit leftovers

From the full backend audit: every numbered finding is fixed. What follows is its "low confidence" list
(real but unlikely to matter, or needing a decision), plus a few loose ends found while fixing the rest.
None are scheduled. Sizes are guesses.

**Behavior to decide or finish**

- **A library restore after a collection's folder was renamed duplicates or drops the collection (M, verified by
  tests).** A bundle names a collection by its chain of folder names (`backup/library.go`); a restore matches that chain
  to the live collections with `EnsureChain` and creates a collection for any segment with no match. Renaming a
  folder moves nothing on disk, so a bundle exported before the rename no longer matches. Tests:
  `backup/library_rename_test.go` (bundle functions) and `api/collection_rename_import_test.go` (scan/import and the
  endpoints); they assert today's behavior, so a fix has to change them.
  - **What happens.** Restore into an empty library, or into the same library with nothing renamed, is fine: every
    collection is created or reused, nothing is duplicated. After a rename it depends on the *display name*:
    - **Display name differs from the old folder** (`Concerts` / `concerts`, renamed to `live`): a second collection
      named after the old folder (`concerts`) is created and the restored items and downloads go to it. The renamed
      collection gets nothing. The new one also gets **none of the entry's settings** (the rename to the bundle's name
      clashes, and the whole update is skipped), so a private collection's items come back **public**, with default
      quality and no Jellyfin library. A renamed parent makes a whole duplicate subtree (it keeps its settings, since
      its names are free under the new parent); a renamed leaf makes a duplicate leaf under the same parent.
    - **Display name equals the old folder** (`Podcasts` / `Podcasts`, renamed to `Pods`), which is how a collection made
      by name usually looks: the create is refused (`ErrDuplicateName`) and the restore swallows it. Nothing is
      created, the items are **uncategorized**, a download-mode restore queues them with no collection (they land in
      the media root), the restore reports success. Same for a renamed parent (the whole subtree) or leaf.
    - **Case variants** (`Concerts` vs `concerts`) are fine: the collection is reused (the sibling-folder rule's
      case-insensitive fallback). An exact spelling wins over a case variant. Only the preview is off: it counts the
      case variant as one new collection.
    - **Display name renamed, folder unchanged:** matched by folder, no duplicate, but the entry **overwrites** the
      live collection's name, default quality/type, privacy, Jellyfin library, season and artist with the backup's
      values (done on purpose in the code; `FEATURES.md` wrongly said "never overwriting existing ones" until now). A
      collection made private after the backup becomes public again. If the bundle's name is taken by a sibling the
      whole entry, privacy included, is skipped.
    - **Untracked-file scan/import:** a tracked item in an old folder is *not* untracked (the scan matches files to
      rows by stored path, not by folder), so a rename never makes existing items show up. An *untracked* file in the
      old folder is offered as "new collection `concerts`"; importing creates the duplicate (display name differs) or
      fails with a 500 and stays in the list forever (name equals the old folder).
  - **How likely.** Low. It needs a folder rename (the dialog says it moves nothing) **and** a restore into that same
    library afterwards; a restore into a fresh install, the main use, is unaffected. Plausible case: re-importing an
    older backup to recover something. For the scan path, the redownload bug that used to leave files in the old
    folder is fixed, and downloads, Move and redownload all keep rows and files consistent, so only hand-copied or
    other-tool files get there. The harm when it does happen is quiet (success message, wrong placement, lost privacy).
  - **Candidate fixes.**
    1. *Match by display name when the folder doesn't match* (restore only: before creating, look for a collection at
       the same parent with the entry's `name`). No format change, also fixes old bundles; a name can be shared by
       two unrelated folders only if the user made it so, and siblings can't share a name. Heuristic, so a stale
       name can still mismatch.
    2. *A stable id in the bundle* (new `collections.uid` column and migration, backfilled; exported on entries and
       items, matched before the folder chain). Exact and survives any rename; costs a migration, old bundles still
       need fix 1 or the old path, and an id carried to another install has to be handled.
    3. *Never act silently* (independent of 1/2): apply the entry's settings even when only the name clashes, return
       the number of collections the restore created or couldn't create (and show it in the preview/result), and
       make the preview flag a chain that matches no folder but matches a name.
    4. *Accept and document* (done in `FEATURES.md`); cheapest, but the privacy loss stays.
  - **Recommendation.** 1 + 3 now (small, backend only, no format change); 2 only if bundles ever need to move
    between installs that renamed things independently. Also decide whether a restore should overwrite a matched
    collection's settings at all, or only fill a new one (the privacy regression argues for "only fill").
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
