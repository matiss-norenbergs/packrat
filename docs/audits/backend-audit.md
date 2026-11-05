# Backend audit (2026-11-05)

A read-only audit of `backend/` covering odd behavior, optimization opportunities and security
hygiene. It was done in six parallel slices, then merged: duplicates were folded into one finding
that lists every location, and the lead re-read the code behind every `critical`/`high` finding.
No source, tests, migrations or config were changed.

Slices: **S1** API handlers A (library items and files), **S2** API handlers B (everything else in
`api`), **S3** persistence (repository, db, models, migrations), **S4** download pipeline, **S5**
background and media jobs + `cmd/server`, **S6** security and infrastructure (incl. route protection).

Things the docs call deliberate were not counted: WebSocket `CheckOrigin` always true,
in-memory-only login throttling, `Secure=false` session cookie, unencrypted backups by default,
plaintext Jellyfin key / AI password in the settings GET, the single user.

## Summary

67 findings were reported across the slices; **56 remain after de-duplication** (11 merged into
another finding). No `critical` findings.

| Slice | Reported | After merge | high | medium | low |
|---|---:|---:|---:|---:|---:|
| S1 API handlers A | 14 | 11 | 2 | 5 | 4 |
| S2 API handlers B | 15 | 9 | 0 | 6 | 3 |
| S3 Persistence | 7 | 6 | 2 | 3 | 1 |
| S4 Download pipeline | 11 | 10 | 3 | 4 | 3 |
| S5 Background jobs | 13 | 13 | 2 | 7 | 4 |
| S6 Security / infra | 7 | 7 | 0 | 3 | 4 |
| **Total** | **67** | **56** | **9** | **28** | **19** |

| Category | high | medium | low | Total |
|---|---:|---:|---:|---:|
| security | 1 | 7 | 8 | 16 |
| behavior | 6 | 15 | 8 | 29 |
| performance | 2 | 6 | 3 | 11 |

**Lead spot-check:** all nine `high` findings were re-read against the cited code and hold
(S1-1, S1-2, S3-1, S3-2, S4-1, S4-2, S4-3, S5-1, S5-2). One was downgraded: S1-3 (merged with
S3-3, sequence-gap loop) from `high` to `medium`, because the trigger is an admin-entered
out-of-range number, not anything external. Severities were assigned to four S2 findings that
came back without one (S2-8, S2-9 medium; S2-10, S2-11 low, both since merged).

**Tooling:** `go build ./...` and `go vet` clean everywhere. `go test -race` passed for every
audited package, with no races reported; packages without tests got no race coverage
(thumbnailenhance, framematch, imagebackfill, cmd/server, imagefetch, importer, ghostthumb,
pathsafe, ws, version, db, models). `staticcheck` found nothing in S4/S5 packages (not run on the
others). `govulncheck` could not run: the vulnerability database download was blocked by the
sandbox proxy, so **dependency CVEs are unchecked**. S3 reproduced S3-1, S3-2, S3-3, S3-5 and S3-7
with throw-away overlay tests kept outside the repo.

---

## Security findings

### S4-1 [SECURITY] yt-dlp gets the URL after its options with no `--`; subscription entries and File Import URLs are never checked, so a value starting with `-` is read as an option
- **Category:** security · **Severity:** high · **Confidence:** likely
- **Merged:** S2-2
- **Where:** `backend/internal/downloader/args.go:81`; `backend/internal/downloader/ytdlp.go:149,183,221`; unchecked sources: `backend/internal/subscriptions/checker.go:247-271` (`enqueueSubscriptionDownload`, comment says URL validation "doesn't apply"), `checker.go:376` (`FetchThumbnail`); `backend/internal/api/import_handler.go:159-162` and `backend/internal/api/dto.go:1374-1377` (`ImportRequest.OriginalURL` unvalidated)
- **Scenario:** Every HTTP download path calls `isHTTPURL`, but two do not. A subscription's flat-playlist entries carry a `url` that comes from remote content; yt-dlp's generic RSS extractor uses each item's `<link>` as-is. A feed item whose link is `--exec=…` is enqueued unchanged by the hourly check, and `FetchMetadata`/`Run` append it last, so yt-dlp parses it as an option and runs a command as the server user. Reaching this needs only a feed the admin subscribed to. `POST /api/import` with `originalUrl: "--config-locations=…"` does the same (needs an admin session + CSRF), and the value is stored and reused by later redownloads.
- **Suggested fix:** Add `"--"` before the URL in `BuildArgs`, `FetchMetadata`, `FetchThumbnail` and `FetchThumbnailRaw`. Also enforce http(s) inside `DownloadManager.Enqueue` (so no caller can skip it), on subscription entries and in `CreateImport`. Size: tiny.
- **Note:** Packrat's side was traced end to end. yt-dlp is not installed in the audit sandbox, so its parsing of a trailing `--exec` argument was not reproduced.

### S4-8 [SECURITY] Remote-supplied thumbnail URLs are fetched server-side with no private-address check and no size cap
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/imagefetch/imagefetch.go:72-97` (`open`), `:134` (unbounded `io.Copy`); reached from `backend/internal/queue/manager.go:1184` (`meta.Thumbnail` from yt-dlp JSON), `ghostthumb.Generate`, and `GET` preview-image at `backend/internal/api/downloads_handler.go:84-104`
- **Scenario:** `meta.Thumbnail` comes from the downloaded page, so it is attacker-controlled. A malicious page can set it to `http://169.254.169.254/…`, `http://127.0.0.1:<port>/…` or a LAN admin UI, and every download or subscription hit makes the server send that GET, following redirects. An image Content-Type also gets the response tiered and shown in the UI. The body is copied to a temp dir with no limit, for up to 20 s (5 min for image downloads), so a hostile server can fill `/tmp`. Reaching this needs only a malicious URL that the admin downloads or subscribes to.
- **Suggested fix:** Use a dialer `Control` hook that rejects loopback, link-local, private and unspecified IPs after DNS resolution (this also covers redirects and DNS rebinding), at least for remote-supplied thumbnails. Wrap the body in `io.LimitReader` (e.g. 50 MB). Size: small.

### S6-1 [SECURITY] Login/2FA throttling is check-then-act, so concurrent requests get far more guesses than the limits allow
- **Category:** security · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/api/auth_deps.go:305-334`, `auth_handler.go:159-179`, `auth_2fa_handler.go:68-111`, `backend/internal/twofactor/challenge.go:71-95`
- **Scenario:** `Limiter.Check` runs first and `Limiter.Fail` only after bcrypt (~50-100 ms) or the TOTP check, with nothing reserved in between. An unauthenticated client keeping N requests in flight gets about N guesses per wave instead of 10 per IP / 30 globally. The same holds for `/auth/login/2fa`: every parallel request passes `Challenges.Lookup` before any `Fail`, so "5 wrong codes destroy the challenge" does not hold. That step needs the password first.
- **Suggested fix:** Record the attempt under the lock at check time and refund it on success. Or serialise credential checks with a semaphore of 1 (one account, so no cost). Count challenge attempts inside `Lookup`. Size: small.

### S6-2 [SECURITY] Enabling 2FA needs only a session, so a hijacked or left-open session can lock the owner out
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/auth_2fa_handler.go:180-255` (`TwoFactorSetup`/`TwoFactorEnable` have no `checkPassword`); compare `auth_handler.go:210-236` and `docs/api.md:125-127`
- **Scenario:** Password change, 2FA disable and recovery-code regeneration require the current password, so that "a hijacked/left-open session can't lock out the real owner". Enabling 2FA does not. A stolen cookie or desktop bearer token can enroll the attacker's authenticator, enable 2FA and keep the recovery codes. Getting back in then needs shell access (`packrat --disable-2fa`).
- **Suggested fix:** Require `password` in `/2fa/enable` (or `/2fa/setup`), verified with `checkPassword` and rate-limited with `KindPassword`; update `docs/api.md` and the dialog. Size: small.

### S6-3 [SECURITY] `POST /api/auth/setup` race can create two admin accounts
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Merged:** S2-1
- **Where:** `backend/internal/api/auth_handler.go:115-151`; `backend/internal/repository/users_repo.go:22-23`; `database/migrations/000008_users.up.sql` (only `username` is UNIQUE)
- **Scenario:** Setup runs `Count()`, then bcrypt, then `INSERT`, with no lock. Two concurrent unauthenticated setup calls with different usernames both see 0 users and both succeed, which breaks "setup permanently 409s after the first user". The second account has full access, and the owner cannot see it: sessions are per user and `admincmd` acts on `users.First()`. It is reachable by anyone on the network before the owner finishes the wizard. `ShouldBindJSON` ignores Content-Type, so a cross-site `text/plain` POST also works.
- **Suggested fix:** Use a single conditional insert (`INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM users)`, then check rows affected), or a mutex around count+insert. Optionally require `application/json` on public POSTs. Size: tiny.

### S2-3 [SECURITY] AI Enhancement password is sent as a GET query parameter and written to the access log
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/thumbnailenhance_handler.go:228-246` (`c.Query("password")`); `frontend/src/lib/api.ts:1201-1205`; `backend/internal/api/logger.go:11-16` (only `token=` redacted)
- **Scenario:** "Load models" calls `GET /api/thumbnail-enhancement/upscalers?…&password=<secret>`. The access log only masks `token=`, so every click prints the A1111 password to container stdout (`docker logs`), and it also ends up in browser history and reverse-proxy logs. Non-200 upstream replies are echoed back (up to 4 KB) to the admin caller.
- **Suggested fix:** Make it a POST with a JSON body (CSRF-protected); at minimum also redact `password=` in the logger. Size: small.

### S2-4 [SECURITY] `/api/logs` exposes proxy credentials, and "Anonymize History Links" leaks the URL through other fields
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Merged:** S1-12
- **Where:** `backend/internal/api/logs_handler.go:15-34`; `backend/internal/api/dto.go:1339-1361` (`toLogEntryResponse`), `dto.go:1302-1318` (History `ErrorMessage` passed through); `backend/internal/downloader/ytdlp.go:386` (`Command` = full argv); `backend/internal/downloader/args.go:133-135` (`--proxy <value>`)
- **Scenario:** The stored `ytdlp_command` is the full argv. That includes `--proxy http://user:pass@host`, which is returned as-is in `ytdlpCommand` and kept indefinitely unless log retention is set. With `historyAnonymizeUrls` on, `url`/`title` are hashed, but `ytdlpCommand`, `stdoutTail`/`stderrTail` ("Extracting URL: …") and `errorMessage` (`ERROR: [youtube] <id>: …`, on both the Logs and History pages) still show what was downloaded. That contradicts docs/api.md ("Same URL/title anonymization as History").
- **Suggested fix:** Redact proxy userinfo (and the cookies path) when building `RunResult.Command`. When anonymizing, replace the URL and video id in command, tails and error message, or omit those fields. Size: small.

### S5-9 [SECURITY] Disk backups that contain secrets are world-readable
- **Category:** security · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/backup/auto.go:98` (`os.WriteFile(…, 0o644)`); `backend/internal/backup/settings.go:9-11` (all settings rows); `backend/internal/config/config.go:128` (dir `0755`)
- **Scenario:** The unencrypted full bundle (unencrypted by design) holds every settings row, including the Jellyfin API key, the AI Enhancement password and the raw yt-dlp cookies (browser session cookies). The cookies file itself is deliberately written `0600`, but backups are `0644` in a `0755` dir, usually a host bind mount, so any local user or process on the host can read them. Reaching them needs local host access.
- **Suggested fix:** Write backups `0600` and create `BACKUPS_ROOT` `0700`. Size: tiny.

### S6-4 [SECURITY] Public `GET /api/version` calls the GitHub API on every request, uncached
- **Category:** security (reported as performance by S6) · **Severity:** low · **Confidence:** confirmed
- **Merged:** S2-12
- **Where:** `backend/internal/api/version_handler.go:24-33`; `backend/internal/version/latest.go:16-48`
- **Scenario:** Any unauthenticated caller makes the server call `api.github.com` (10 s timeout, a goroutine held for its duration). GitHub's unauthenticated limit (60/h per IP) is used up after 60 requests, after which `latestVersion` is null for everyone for an hour.
- **Suggested fix:** Cache the latest tag for about 1 h (shorter on failure) behind `singleflight`; the PyPI yt-dlp check can share it. Size: small.

### S6-5 [SECURITY] An open WebSocket outlives logout and session revocation
- **Category:** security · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/router.go:389`; `backend/internal/ws/hub.go:94-112`; `backend/internal/ws/client.go:27-44`
- **Scenario:** Auth is checked only on upgrade, and `Client` keeps no session reference. After "Revoke session", logout or `--reset-password`, the device's `/ws` keeps receiving every broadcast (titles, errors, ids), kept alive by ping/pong.
- **Suggested fix:** Store the session token on `Client`. Re-validate it on the ping tick, or have revoke/logout tell the hub to close matching clients. Size: small.

### S6-6 [SECURITY] `/media-files/` and `/local-images/` serve directory listings and follow symlinks
- **Category:** security · **Severity:** low · **Confidence:** confirmed
- **Merged:** S1-14
- **Where:** `backend/internal/api/router.go:376,385` (`StaticFS("/", http.Dir(...))`)
- **Scenario:** A raw `http.Dir` turns listings on: `GET /media-files/` returns an HTML index of every file, including private-collection folders, `.trim-tmp` and `.packrat-tmp` files. It also follows symlinks out of the root. Needs an authenticated session (or a leaked `?token=` URL).
- **Suggested fix:** Use `gin.Dir(root, false)` / `r.Static`. Size: tiny.

### S6-7 [SECURITY] Login timing reveals whether a username exists
- **Category:** security · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/auth_handler.go:166-181`
- **Scenario:** An unknown username returns 401 without running bcrypt; a known one returns after bcrypt (~50-100 ms). An unauthenticated attacker can confirm the single admin username in one or two requests.
- **Suggested fix:** On `ErrNotFound`, compare against a fixed dummy bcrypt hash. Size: tiny.

### S2-15 [SECURITY] Changing the password leaves every other session signed in
- **Category:** security · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/auth_handler.go:209-247`; `backend/internal/repository/users_repo.go:218-229`
- **Scenario:** An owner who suspects a stolen session changes the password, but the other session stays valid for up to 30 days. The repo comment ("no other-device threat model") predates the per-device sessions list (migration 000047), while the handler and docs/api.md describe guarding against a hijacked session.
- **Suggested fix:** Call `DeleteOtherSessions(userID, currentToken)` after the update (or offer it as a checkbox) and document it. Size: tiny.

### S1-8 [SECURITY] NFO endpoints on a ghost item read and delete `<MediaRoot>.nfo`, outside the media root
- **Category:** security · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/nfo_handler.go:99-100,133-134`; `backend/internal/api/dto.go:440-442`
- **Scenario:** A ghost has `Path == ""`, so the media path resolves to the root itself and `SidecarPath` gives `/media.nfo`, a sibling of the root. `DELETE /api/library/:id/nfo` on a ghost (offered in the UI) deletes that file if it exists; GET reads it, and every ghost reports `nfoExists=true` if it exists. Admin-only, and limited to that one fixed name.
- **Suggested fix:** Return 400/404 and `nfoExists=false` when `item.Path == ""`, as other file handlers already do. Size: tiny.

### S1-10 [SECURITY] Duplicate-detection responses expose a private item's title and thumbnail unblurred
- **Category:** security · **Severity:** low · **Confidence:** likely
- **Where:** `backend/internal/api/dto.go:263-269`; `backend/internal/api/library_handler.go:1130-1136`; `backend/internal/api/downloads_batch.go:70-78`
- **Scenario:** Pasting a URL that matches an item in a private collection, or one with a private tag or artist, returns its real title and thumbnail in `duplicate` (or in batch `Skipped`). These responses bypass `ItemResponder`, contrary to the "every endpoint that returns library items" privacy rule in architecture.md.
- **Suggested fix:** Add a `blurred` flag to `DuplicateInfo` computed via `LoadItemPrivacy`, and have the dialogs honor it. Size: small.

### S5-12 [SECURITY] The AI upscaler's response body is read with no size limit
- **Category:** security · **Severity:** low · **Confidence:** likely
- **Where:** `backend/internal/thumbnailenhance/client.go:96-108,141`
- **Scenario:** The whole base64 `image` JSON field is buffered, then decoded into a second copy, with only a 5-minute timeout. A misbehaving upscaler at the admin-configured URL can exhaust memory. This is about robustness, not SSRF: the URL is admin-set by design.
- **Suggested fix:** Wrap the body in `io.LimitReader` (e.g. 64 MB). Size: tiny.

---

## Other findings, grouped by fix area

Each group is meant to fit in one small PR. Findings are ordered by severity inside each group.

### Group A: SQLite pool, locks and indexes

#### S3-1 Deadlock: the restore transaction holds the only DB connection while waiting on a repo mutex held by a goroutine that is waiting for that connection
- **Category:** behavior · **Severity:** high · **Confidence:** confirmed (mechanism reproduced; the production interleaving is likely)
- **Where:** `backend/internal/db/db.go:22` (`SetMaxOpenConns(1)`); `backend/internal/backup/library.go:458-466,487,514,540,621`; `backend/internal/repository/tags_repo.go:182-196` (`mu` around DB calls); other lockers: `backend/internal/queue/manager.go:564,1173`, `backend/internal/subscriptions/checker.go:354`
- **Scenario:** `ApplyLibraryBundle` opens a tx, which holds the single connection, then calls `tagsRepo.GetOrCreateByNames` per ghost item. If a finishing download with override tags, or the subscription checker, already holds `TagsRepo.mu`, it is waiting for a connection, while the restore waits on `mu`. The tx never commits, so every DB call in the app hangs until restart. S3 reproduced this with an overlay test. A realistic trigger is an import while downloads queued by an earlier import (which carry override tags) are finishing. `ArtistsRepo.mu` and `CollectionsRepo.mu` have the same shape.
- **Suggested fix:** Never take these Go mutexes inside an open tx. Either take them before `BeginTx` for the whole restore, or replace them with DB-level uniqueness (`INSERT … ON CONFLICT DO NOTHING` + re-select). Also see S3-4. Size: medium.
- **Lead check:** confirmed by reading `db.go:22`, `tags_repo.go:182` and `library.go:621`.

#### S3-2 FK child columns have no indexes, so parent deletes scan whole tables per row ("clear download log" took 2m17s and froze the app)
- **Category:** performance · **Severity:** high · **Confidence:** confirmed (query plans + timed run)
- **Where:** migrations `000001_init.up.sql:53,90`, `000013`, `000019`, `000022`, `000032`, `000036`, `000040`; callers `backend/internal/repository/downloads_repo.go:265,284-299`, `library_repo.go:355,805-821`, `tags_repo.go:171`, `artists_repo.go:636`, `backend/internal/api/library_handler.go:273-312`
- **Scenario:** `EXPLAIN QUERY PLAN` shows a full scan of the child table for every deleted parent row:
  - `DELETE FROM downloads` scans `library` and `history`.
  - `DELETE FROM library` scans `frame_match_queue`, `thumbnail_enhancement_history` and `subscription_seen_entries`.
  - `DELETE FROM tags` scans `library_tags`.
  - `DELETE FROM artists` scans four tables.
  - `DELETE FROM collections` scans `downloads` and `subscriptions`.
  
  Deleting 5,000 downloads linked to 20k library and 20k history rows took 2m17s, and because of the single connection (S3-4) every request blocked for that whole time. Artist filters on `library.artist_id` are full scans too.
- **Suggested fix:** Add one migration with `CREATE INDEX IF NOT EXISTS` on these columns:
  - `library(download_id)`, `library(artist_id)`, `library_tags(tag_id)`
  - `history(download_id)`
  - `downloads(override_artist_id)`, `downloads(collection_id)`
  - `collections(artist_id)`, `artist_images(artist_id)`
  - `frame_match_queue(library_item_id)`, `subscription_seen_entries(library_item_id)`, `thumbnail_enhancement_history(library_item_id)`
  - `subscriptions(collection_id)`
  
  Size: small.
- **Lead check:** confirmed. Grepping the migrations finds only `thumbnail_gallery(library_item_id)` and `downloads(ghost_library_item_id)` among `*_id` child indexes.

#### S3-4 `SetMaxOpenConns(1)` serializes every read behind every write, which undoes WAL and turns any slow statement into an app-wide stall
- **Category:** performance · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/db/db.go:14-22`
- **Scenario:** The doc comment says WAL is used so reads "never contend with the single writer", but with one connection every read queues behind any write, open tx or long read. S3-2's 2-minute delete blocked all requests, and S3-1 only deadlocks because of the single connection. With more connections the S3-1 mutex holder would get `SQLITE_BUSY` after 5 s instead of hanging forever. The `_pragma` DSN options are applied per connection, so `foreign_keys` stays on for every connection (verified).
- **Suggested fix:** Use a writer pool (1 connection, `_txlock=immediate`) plus a reader pool (N connections, `query_only`), or at least raise `MaxOpenConns` and rely on `busy_timeout`. Size: medium.

#### S3-5 Unbounded IN-lists exceed SQLite's 32,766-variable limit, which breaks the unpaginated Library list, backup export, Known Items and playlist dedup on large libraries
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed (limit reproduced at 32,767; `FindDuplicates` failed at 17k entries)
- **Merged:** S1-4
- **Where:** `backend/internal/repository/library_repo.go:105-140,256-261`, `downloads_repo.go:85-97,215-236` (2 placeholders per id), `tags_repo.go:250,277,299-316`, `thumbnail_gallery_repo.go:105-120`, `subscriptions_repo.go:176-186`; callers `backend/internal/api/item_privacy.go:104-116`, `backend/internal/backup/library.go:160-184`, `backend/internal/api/subscriptions_handler.go:269-281`, `backend/internal/api/downloads_batch.go:71`
- **Scenario:** `library_pagination_enabled` defaults to off, so `GET /api/library` passes every id into `ActiveDownloadIDsByLibraryItem`. Above about 16.4k items, the Library page and the compare list return 500, and select-all bulk actions fail the same way. Above about 32.7k items, the backup export fails. A playlist enqueue of that size silently skips dedup, because the error is ignored at `downloads_batch.go:71`.
- **Suggested fix:** Chunk IN-lists inside the repo helpers (e.g. 500 per query), or use `IN (SELECT value FROM json_each(?))`. For the export, join in SQL instead of passing ids. Size: small.

#### S3-6 Table-rebuild migrations run without a transaction (`NoTxWrap`, no BEGIN/COMMIT), so a failure partway leaves a dirty, non-rerunnable DB and the server won't start
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/db/db.go:40-41`; `database/migrations/000004_*.up.sql`, `000005_*.up.sql`, `000044_image_download_type.up.sql:469-614`; `backend/cmd/server/main.go:144-146`
- **Scenario:** Migration 044 creates `downloads_new`, copies the data, drops `downloads`, renames, and repeats for `library`. A kill or full disk during the large copy leaves version 44 dirty with half-built tables (in some windows the original is already dropped). The next boot fails with "Dirty database version 44", and re-running fails on `CREATE TABLE downloads_new`, so recovery is manual SQL. The migrations already applied are fine; this is about future rebuilds.
- **Suggested fix:** Use SQLite's 12-step pattern in rebuild migrations: `PRAGMA foreign_keys=OFF; BEGIN; …; PRAGMA foreign_key_check; COMMIT; PRAGMA foreign_keys=ON;`. Size: small.

#### S3-7 The Library list's default sort `ORDER BY <col> IS NULL, <col>` defeats the index (full scan + temp B-tree on every page)
- **Category:** performance · **Severity:** low · **Confidence:** confirmed (query plan)
- **Where:** `backend/internal/repository/library_repo.go:300-333`
- **Scenario:** The default page query plans as `SCAN l` + `USE TEMP B-TREE FOR ORDER BY`, so `idx_library_downloaded_at` is never used. Every 50-row page visits every row, plus a separate `COUNT(*)`. `downloaded_at`, `title` and `filename` are NOT NULL, so the `IS NULL` term does nothing for them.
- **Suggested fix:** Drop the `IS NULL` term for NOT NULL columns. For nullable ones, use `DESC` (NULLs already sort last) or `ASC NULLS LAST`. Size: small.

### Group B: Download pipeline file safety (queue completion and renames)

#### S4-2 `cleanupOrphanedThumbnailArtifacts` matches by glob and can delete other items' media files
- **Category:** behavior · **Severity:** high · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:1350-1366` (called at `:455`); same unescaped glob in `backend/internal/downloader/ytdlp.go:225` (`FetchThumbnailRaw`)
- **Scenario:** When yt-dlp exits non-zero but wrote the file (the AVIF-thumbnail case this code exists for), the cleanup globs `dir/<base>.*` and removes every match except the final file and `.jpg`s. For download `Clip.mp4`, another item's `Clip._Part_2.mp4`, `.nfo` or `.webp` in the same folder is deleted. A literal name keeps `[`/`]`, so `Song [Live]` becomes a character-class pattern that matches unrelated files. It only runs on the non-zero-exit path, but what it deletes is user media.
- **Suggested fix:** Remove only known thumbnail extensions (`.webp`, `.avif`, `.png`, `.jpeg`, …) at exactly `base+ext`, and escape the base if a glob is kept. Size: small.
- **Lead check:** confirmed; `filepath.Glob(filepath.Join(dir, base+".*"))` with removal of every match.

#### S4-3 Completion renames silently overwrite another item's file (ghost fill, extension change, image conversion)
- **Category:** behavior · **Severity:** high · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:893-909` (`completeRedownload` `os.Rename(result.FinalPath, newPath)`); `manager.go:649` (image convert `os.Rename(tmp, target)`)
- **Scenario:** Downloading a ghost uses the redownload flow. With `target.Filename == ""` the file is named from the title and renamed into the collection folder with no existence check, so another item's `Trailer.mp4` is overwritten and two rows point at one file. A redownload that changes webm to mp4 has the same problem. For `downloadType=image`, `Fetch` only checks `Cat.png` is free, then the conversion renames over any existing `Cat.jpg`.
- **Suggested fix:** Before each rename, check the target doesn't exist (or is the item's own path). On a collision, add a suffix or fail via `finishError`, reusing the `fsutil.RenamePair` `ErrDestinationExists` pattern. Size: small.
- **Lead check:** confirmed by reading both rename sites.

#### S4-4 A different video with the same name in the same folder becomes a row pointing at the first video's file
- **Category:** behavior · **Severity:** medium · **Confidence:** likely (yt-dlp's no-overwrite behavior not reproduced here)
- **Where:** `backend/internal/downloader/args.go:36-60`; `backend/internal/queue/manager.go:505-508`
- **Scenario:** yt-dlp defaults to `--no-force-overwrites`: if the output path exists it reports "already downloaded" and exits 0. Two distinct uploads with the same title (common in subscriptions), or a reused literal name, therefore create a new row whose `Path` is the existing file. The new thumbnail overwrites the old one. There is no UNIQUE on `library.path`, so deleting either row deletes the shared file.
- **Suggested fix:** If the resolved output path exists and another row tracks it, disambiguate (append ` [%(id)s]` or a counter). Size: medium.

#### S4-6 A download is marked completed (with history) before its library row exists
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:499-512`; `completeRedownload` `:906-969`
- **Scenario:** `MarkCompleted` and the history entry run first, then `fillOrCreateLibraryItem`. If that fails (busy DB, FK violation because the collection was deleted mid-download), it is only logged: the file is on disk and the download shows completed, but there is no item. In a redownload the old file is already removed (`:913-921`) before `ApplyRedownload`. If that update fails after an extension change, the row points at a deleted filename.
- **Suggested fix:** Create or fill the library row first and mark completed only on success, otherwise go through `finishError`. Roll back the redownload rename on failure. Size: small.

#### S4-10 Exit code 0 with no captured file path creates a "completed" item with an empty path
- **Category:** behavior · **Severity:** low · **Confidence:** likely
- **Where:** `backend/internal/queue/manager.go:438-460,472-508,786-791`
- **Scenario:** The `FinalPath == ""` guard only applies to non-zero exits. If `after_move` never fires (e.g. a pure-playlist URL resolving to 0 entries under `--no-playlist`), the item gets `Path=""`, `Filename="."` and status completed. A ghost for that run turns into the same broken row.
- **Suggested fix:** Treat an empty `FinalPath` (or a failed stat) as a failure regardless of the exit code. Size: tiny.

### Group C: Per-item serialization of background file rewrites

#### S1-2 The background metadata remux is not serialized per item, which can corrupt the file or undo a trim, move or redownload
- **Category:** behavior · **Severity:** high · **Confidence:** likely
- **Merged:** S4-9
- **Where:** `backend/internal/api/library_handler.go:483-490`; `backend/internal/queue/manager.go:598-602,1095-1099`; `backend/internal/downloader/ytdlp.go:254-282`
- **Scenario:** Every PATCH touching title/artist/year/season/sequence, and every completed download with overrides, starts a detached goroutine. It runs ffmpeg `-y -i P … P.packrat-tmp.ext`, then `os.Rename(tmp, P)`.
  - Two saves a few seconds apart run two ffmpegs that write the same fixed tmp path, so P can end up an interleaved, corrupt mux.
  - A trim accept, Move, delete or redownload that lands mid-embed is undone: the final rename puts old content back at P, or recreates P at its old location after a move. On a multi-GB file this window is minutes.
  - A server stop mid-remux leaves the `.packrat-tmp.<ext>` file behind, and it shows up in the import scan.
- **Suggested fix:** Use a per-item keyed lock shared by embed, rename, move, trim, redownload and delete. Use a unique temp name (`os.CreateTemp` in the same dir), and re-check that P is still the item's path before the final rename. Size: medium.
- **Lead check:** confirmed: fixed tmp name, no lock beyond the global `embedMetadataSem` (4 slots).

### Group D: Image-item thumbnail handling

#### S1-1 Thumbnail actions on a downloaded image item delete or overwrite the image file itself
- **Category:** behavior · **Severity:** high · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:793-797` (image stores `Thumbnail = finalPath`); `backend/internal/api/thumbnail_handler.go:536-540` (delete), `:495-501` (set), `:166-172` (redownload thumbnail); `backend/internal/api/thumbnail_gallery_handler.go:257-261` (apply)
- **Scenario:** For `downloadType=image` the stored thumbnail is the media file itself.
  - Thumbnail → Delete, which the menu offers for images (`frontend/src/components/library/libraryItemActions.tsx:343-350`), runs `os.Remove` on it. The row keeps its `path` and points at a deleted file.
  - Gallery Apply and SetLibraryThumbnail write to `<base>.jpg`, which for a `.jpg` image item is the media file, so the original image is overwritten.
  - Related (low confidence): QuickGrab and frame-match accept have no backend guard either. DeleteLibraryItemFile with `deleteThumbnail=false` leaves `thumbnail` pointing at the deleted media.
- **Suggested fix:** In these handlers, never remove or write a path equal to `item.Path`. For image items, treat the thumbnail as tiers-only (or 400), and hide the menu entries. Size: small.
- **Lead check:** confirmed (`thumbAbs = finalPath` for images; the delete handler removes `item.Thumbnail` unconditionally).

### Group E: Download queue concurrency

#### S4-5 `Enqueue` blocks on a 100-slot channel and ignores the context, so large batches hang requests and partially fail
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:137,213-223`; callers `backend/internal/api/downloads_batch.go:74-95`, `backend/internal/api/backup_handler.go:261-282`, `backend/internal/subscriptions/checker.go:271`
- **Scenario:** With 2 workers, a 200-item bulk submit or a 500-entry playlist creates rows 1 to about 102, then blocks until a whole download finishes. The request hangs for hours. When the client or proxy gives up, the remaining `Create`s fail and the user doesn't know what got queued. At shutdown an in-flight `Enqueue` blocks forever, and a subscription sweep stalls the same way.
- **Suggested fix:** Decouple the persisted queue from the channel (an unbounded FIFO, or workers polling queued rows), or at least `select` on `ctx.Done()` and `rootCtx.Done()`. Size: small–medium.

#### S4-7 Cancelling a queued download can lose a race with the worker starting it
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/queue/manager.go:227-284`; `backend/internal/repository/downloads_repo.go:131`
- **Scenario:** `runOne` loads the row (queued) and passes the cancelled check. `Cancel` then finds no cancel func yet and marks the row cancelled. `runOne` unconditionally sets `fetching_metadata` and downloads anyway, so the user sees "cancelled" and then a completed download.
- **Suggested fix:** Make the `queued → fetching_metadata` transition conditional (`WHERE status='queued'`) and skip the run if 0 rows change, or register the cancel func under `m.mu` before the check. Size: small.

### Group F: Subscriptions

#### S5-3 Concurrent or duplicate subscription checks create duplicate ghosts or downloads
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Merged:** S2-5
- **Where:** `backend/internal/subscriptions/checker.go:50,69,171-225`; `backend/internal/api/subscriptions_handler.go:223-262`
- **Scenario:** "Check now" calls `CheckOne` without `sweepMu`. Two clicks, two tabs, or a click during the hourly sweep read the same unseen set, and both create a ghost or enqueue for every new entry. The second `RecordSeenEntry` then hits UNIQUE and is only logged. A playlist that lists the same id twice also yields two items, because `seen` is not updated inside the loop. If `RecordSeenEntry` fails after the action (ctx cancelled), the next check repeats it.
- **Suggested fix:** Claim each entry first with `INSERT OR IGNORE` and act only when one row is inserted, then link `library_item_id`. Dedupe ids in `processEntries`, and take a per-subscription lock (or `sweepMu`) in `CheckOne`. Size: small.

#### S5-4 An interrupted baseline leaves the subscription enabled and never checked, so the back catalog is treated as new
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/api/subscriptions_handler.go:62-78`; `backend/internal/subscriptions/checker.go:138-143,220-222`
- **Scenario:** The baseline runs one autocommit INSERT per entry on the request context. If the tab closes partway, the rest fail (only logged), but the subscription row is already committed with `enabled=1, last_checked_at=NULL`. The next sweep turns every unrecorded back-catalog entry into a ghost, or a queued download if auto-download is on, possibly thousands.
- **Suggested fix:** Run the insert and baseline in one transaction (or disable/delete the subscription on failure), with a detached context. Size: small.

#### S5-13 `checkIntervalHours` is not bounds-checked on update
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/subscriptions_handler.go:174`; `backend/internal/api/dto.go:1556`; `backend/internal/subscriptions/checker.go:82`
- **Scenario:** PATCH with `0` or a negative value (or one large enough to overflow `time.Duration`) makes the subscription due on every hourly tick. Create clamps `<=0` to 6; update does not.
- **Suggested fix:** Validate the range on update the same way as on create. Size: tiny.

### Group G: Backup and restore

#### S5-1 Failed backups count toward retention, so a run of scheduled failures deletes every good backup
- **Category:** behavior · **Severity:** high · **Confidence:** confirmed
- **Where:** `backend/internal/backup/auto.go:130-139` (`recordFailure` → `pruneOldBackups`), `:151-180`, `:195-204`; `backend/internal/repository/backup_history_repo.go:90-114` (`ORDER BY created_at DESC LIMIT -1 OFFSET ?`, no status filter)
- **Scenario:** Auto-backup is on with the default retention of 14, and backups start failing (read-only or full `BACKUPS_ROOT`, a DB error). "Due" is keyed on `LatestSuccessful`, so it retries every hourly tick. Each failure inserts a `failed` row and prunes everything past the newest 14 of any status. After about 14 hours every success row is past the offset and its file is removed, so the good backups are destroyed exactly when the system is unhealthy.
- **Suggested fix:** Apply file retention to `status='success'` rows only, cap failed rows separately, and optionally back off retries after a failure. Size: small.
- **Lead check:** confirmed: `recordFailure` calls `pruneOldBackups`, and the repo query has no status filter.

#### S2-6 Settings import and full restore don't write the yt-dlp cookies file, so restored cookies are silently not used
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/backup_handler.go:105-162,569-586`; `backend/internal/backup/settings.go:26-37`; `backend/internal/api/settings_handler.go:859` (`writeCookiesFile`, only called from `UpdateSettings`); `backend/internal/downloader/args.go:101-108`
- **Scenario:** After a restore the `ytdlp_cookies_file` row is set, but `ytdlp-cookies.txt` is never written. `--cookies` points at a missing or stale file while Settings shows the restored content, so downloads that need login fail or use old cookies. Nothing syncs the file at startup.
- **Suggested fix:** After `ApplySettingsBundle`, write the cookies file (pass the ytdlp service into the restore handlers), or sync it from the DB at startup. Size: small.

#### S2-14 Settings PATCH and full restore can fail after already saving part of the change
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/settings_handler.go:1264-1270,1373-1377,1439-1441,1461-1465,1517-1519`; `backend/internal/api/backup_handler.go:569-586`; `backend/internal/backup/settings.go:26-37`
- **Scenario:** `PATCH {"maxConcurrentDownloads":8,"resolutionThresholdLow":2160,"resolutionThresholdHigh":720}` returns 400, but the worker pool already grew to 8 and the row is saved. In a full restore all settings, credentials included, are overwritten before the library step. If that step fails, the response is 500 and the settings stay replaced. `ApplySettingsBundle` writes key by key with no transaction.
- **Suggested fix:** Validate everything before the first `Set`. Write settings in one transaction and apply side effects after commit. Size: medium.

### Group H: Background-job lifecycle and shutdown

#### S5-6 Shutdown doesn't wait for background jobs; the DB closes and the process exits mid-write
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/cmd/server/main.go:142,257-297,358-363`; detached `context.Background()` jobs at `backend/internal/api/thumbnailenhance_handler.go:211,320,341`, `backend/internal/imagebackfill/manager.go:101`, `backend/internal/queue/manager.go:709`
- **Scenario:** `run()` returns as soon as `srv.Shutdown` finishes (at most 10 s). It never waits for the download workers, the hourly sweep, `framematch.RunQueue` or the detached enhancement/backfill goroutines. Their terminal DB writes fail on a cancelled context (S5-5), or the process exits mid-operation (e.g. sidecar overwritten, DB and history not yet written), while the deferred `conn.Close()` may already have run.
- **Suggested fix:** Track background goroutines with a WaitGroup under a root context cancelled on shutdown, wait (bounded) before `conn.Close()`, and use `context.WithoutCancel` + a short timeout for terminal writes. Size: medium.

#### S5-5 Frame-match queue rows stay `running` forever after shutdown or crash, which blocks re-enqueueing the item
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/framematch/queue.go:185-196,217-223`; `backend/internal/repository/frame_match_queue_repo.go:37-46,98-103`; `backend/cmd/server/main.go:188-199`
- **Scenario:** On SIGTERM, `fail()` writes `SetError` with the already-cancelled context, so the row stays `running`. A crash writes nothing at all. Nothing resets `running` rows at startup, `NextQueued` skips them, and `ExistsForLibraryItem` rejects a new match for that item until the row is deleted by hand.
- **Suggested fix:** Reset `running` rows at startup (like `MarkInterruptedIfActive`), and use a detached context for the terminal write. Size: small.

#### S2-7 The yt-dlp update runs `pip install` on the request context, so leaving the page can kill pip midway
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/api/ytdlp_handler.go:44-53`; `backend/internal/downloader/version.go:78-103`
- **Scenario:** Closing the tab during "Update yt-dlp" cancels the context and SIGKILLs pip. If that lands after the old package is removed but before the new one is installed, the container has no yt-dlp and every download fails. Two clicks also run two pip upgrades at once.
- **Suggested fix:** Run the upgrade on `context.WithoutCancel` + timeout behind a TryLock, and return 409 if one is already running. Size: small.

#### S5-7 AI enhancement overwrites the sidecar in place before derivatives and DB succeed
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/thumbnailenhance/enhance.go:672-686,746-782`
- **Scenario:** `os.WriteFile(thumbAbs, upscaled)` runs first and is not atomic. If tier generation, probe or `UpdateThumbnailTiers` then fails, history says `failed` but the on-disk thumbnail (what Jellyfin reads) is already replaced, while the DB still describes the old one. With `autoApprove=true` no original is kept, and a failed row offers no Revert. A crash mid-write truncates the file.
- **Suggested fix:** Write to a temp file in the same dir, derive tiers and probe from it, then rename over the sidecar and update the DB. On failure, remove the temp file. Size: small.

### Group I: Frame-match and enhancement resource use

#### S5-2 Frame-match coarse sweep buffers the whole video's full-resolution MJPEG stream in RAM (OOM risk)
- **Category:** performance · **Severity:** high · **Confidence:** confirmed (by code; not run against a long video)
- **Where:** `backend/internal/framematch/match.go:198-226`
- **Scenario:** `coarseSweep` runs ffmpeg at `fps=1`, native resolution, `-q:v 4`, and collects stdout with `cmd.Output()`. A 2-hour 1080p video is about 7,200 JPEGs, roughly 1.5–3 GB in one slice. Each frame is then fully decoded just to compute a 64-bit pHash. The bulk queue does this item after item, and an OOM kill takes down the server and active downloads with it.
- **Suggested fix:** Downscale in the filter (`fps=1,scale=160:-1` or smaller; pHash resizes to 64×64 anyway), and/or hash frames as they stream from `StdoutPipe` instead of buffering. Size: small.
- **Lead check:** confirmed (`cmd.Output()` on unscaled `image2pipe`).

#### S5-8 Auto-enhance-on-download re-probes every library thumbnail to check one item
- **Category:** performance · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/thumbnailenhance/enhance.go:269-323,447-464`; `backend/internal/queue/manager.go:554,709`
- **Scenario:** After each completed download, `MaybeAutoEnhanceOnDownload` runs `LibraryRepo.List` and then `Stat` + `Open` + `DecodeConfig` on every item's thumbnail, only to find one id. With 10k items, a 100-entry playlist means about 1M file opens on NAS storage. `WouldRunCount`, `RunOnce` and the hourly sweep scan the same way.
- **Suggested fix:** On the single-item path, `Get(id)` and probe one file. For sweeps, filter with SQL on the stored `thumbnail_width`/`thumbnail_height` and probe only the candidates. Size: small.

#### S5-10 Bulk frame-match items have no timeout, and the single-item 5-minute timeout includes time spent waiting for `matchMu`
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Merged:** S2-10 (timeout half)
- **Where:** `backend/internal/framematch/queue.go:217-219`; `backend/internal/framematch/job.go:59-65`
- **Scenario:** A wedged ffmpeg in a queue item holds `matchMu` indefinitely and the queue never advances. A single-item job created while a long queue match runs spends its 5 minutes waiting for the lock, then fails with "deadline exceeded" without doing any work.
- **Suggested fix:** Apply `matchTimeout` per queue item, and start the single-item deadline after acquiring the lock. Size: tiny.

#### S5-11 Frame-match `JobStore` never evicts finished jobs
- **Category:** performance · **Severity:** low · **Confidence:** confirmed
- **Merged:** S2-10 (memory half)
- **Where:** `backend/internal/framematch/job.go:40-87`; `backend/internal/api/framematch_handler.go:69`
- **Scenario:** Every single-item match leaves a `JobStatus` holding two base64 JPEGs (hundreds of KB) in memory for the life of the process.
- **Suggested fix:** Evict jobs on a TTL (e.g. 30 min) or after their terminal state has been read. Size: tiny.

### Group J: Library handler correctness

#### S1-7 "Scan for missing files" turns items into ghosts on any stat error, with no guard against an unmounted media root
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/ghost_handler.go:217-226`
- **Scenario:** Any `os.Stat` error (EACCES, EIO, a stale NFS/SMB handle) runs `ClearFile`, which irreversibly blanks `path`/`filename`. If the NAS bind mount is offline (empty mount point), one click turns the whole library into ghosts and every file path is lost, even though the files come back when the mount does.
- **Suggested fix:** Convert only on `os.IsNotExist`. Refuse when `MEDIA_ROOT` is empty or unreadable, or when the scan would clear more than a threshold share, unless confirmed. Size: small.

#### S1-5 Redownloading an audio or image item becomes a video download once its downloads row has been pruned
- **Category:** behavior · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/api/library_handler.go:1079-1101`
- **Scenario:** The download type comes only from the original `downloads` row, falling back to the global default ("video"). After "Clear download log" or the retention sweep, redownloading an `.mp3` item fetches video and replaces the audio file. An image item goes through yt-dlp instead of `imagefetch`, even though `item.MediaType` holds the right type.
- **Suggested fix:** Fall back to `item.MediaType` before the global default. Size: tiny.

#### S1-6 Rename and Move leave the `.nfo` sidecar behind
- **Category:** behavior · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/library_handler.go:384-420,596-678`
- **Scenario:** Both handlers move only the media file and its thumbnail. `foo.nfo` stays at the old place, so Jellyfin loses the metadata for `bar.mp4`. The old `.nfo` is also never cleaned up, because delete only removes the sidecar of the current path.
- **Suggested fix:** Move or rename the `.nfo` along with the media file, like the thumbnail. Size: small.

#### S1-11 Bulk and playlist "skip duplicates" don't dedupe entries within the same batch
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/downloads_batch.go:62-89`
- **Scenario:** The same URL pasted twice, or a playlist that lists a video twice, with `skipDuplicates=true` queues both, giving two downloads and two items or a filename collision.
- **Suggested fix:** Track the URLs and video ids already queued in this call. Size: tiny.

#### S1-13 A multi-field `PATCH /library/:id` partially applies, then reports failure
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/library_handler.go:377-420`
- **Scenario:** `UpdateTitle` is committed before the filename rename. A rename collision returns 409, but the title is already saved and the later fields (tags, metadata) were silently not applied.
- **Suggested fix:** Do the rename (the only fallible disk step) first, or validate the destination before any DB write. Size: small.

#### S2-13 Deleting an artist image doesn't check that the image belongs to that artist
- **Category:** behavior · **Severity:** low · **Confidence:** confirmed
- **Where:** `backend/internal/api/artist_images_handler.go:130-160`; `backend/internal/repository/artists_repo.go:217-226`
- **Scenario:** `DELETE /api/artists/1/images/99`, where image 99 belongs to artist 2, deletes artist 2's row and file and leaves artist 2's `selected_image_path` dangling. `SelectArtistImage` does check ownership.
- **Suggested fix:** Add `AND artist_id = ?` (or check `img.ArtistID`) and clear the owning artist's selection. Size: tiny.

### Group K: Input bounds

#### S1-3 `GET /api/collections` loops over every integer between a collection's min and max sequence number, for minutes or (at MaxInt64) forever
- **Category:** performance · **Severity:** medium (downgraded from high by the lead: the trigger is an admin-entered value) · **Confidence:** confirmed (S3 measured 14.5 s at 2e9)
- **Merged:** S3-3
- **Where:** `backend/internal/repository/library_repo.go:599-624`; `backend/internal/api/collections_handler.go:40-48`; unbounded inputs at `backend/internal/api/dto.go:500,796-797,812-813`
- **Scenario:** The sample is capped at 50 but the walk is not. One item or collection bound of 1,000,000,000 (a typo; only `min=1` is enforced) costs about 1e9 iterations on every collections fetch. At 9223372036854775807, `n <= max` is always true (`n++` wraps around), so each request goroutine spins forever and pins a CPU.
- **Suggested fix:** Count the gaps arithmetically (`(max-min+1) − distinct present values`), walk only until 50 missing values are collected, and bound the sequence/season inputs (e.g. 1..1e6) in the DTOs. Size: small.

### Group L: Hot-path query and I/O costs

#### S2-8 `GET /api/logs` reads the whole downloads table (including ~8 KB output tails per row), then keeps 200
- **Category:** performance · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/logs_handler.go:17-23`; `backend/internal/repository/downloads_repo.go:113-128,374-381`
- **Scenario:** No `LIMIT`, and retention defaults to keep-forever. After 20k downloads every Logs page load scans and allocates hundreds of MB.
- **Suggested fix:** Add `ListRecent(limit)` with `LIMIT ?` (`idx_downloads_created_at` exists). Size: tiny.

#### S2-9 The AI Enhancement history page loads the entire library for every 25-row page
- **Category:** performance · **Severity:** medium · **Confidence:** confirmed
- **Where:** `backend/internal/api/thumbnailenhance_handler.go:64-72`
- **Scenario:** `LibraryRepo.List(ctx)` runs on every page, search keystroke and filter change just to map at most 25 history rows to items. The cost scales with library size, not page size.
- **Suggested fix:** Fetch only the page's ids (`WHERE id IN (...)`). Size: small.

#### S1-9 Every library list response runs one filesystem stat per item for `nfoExists`
- **Category:** performance · **Severity:** medium · **Confidence:** likely
- **Where:** `backend/internal/api/dto.go:440-442` (called per item from `item_privacy.go:127`)
- **Scenario:** With pagination off (the default), every `GET /api/library`, which is refetched after each mutation, does N serial stats. On a 10k-item SMB/NFS root at 1–5 ms per stat, that adds 10–50 s per request.
- **Suggested fix:** Stat only in single-item responses or for `generate_nfo=1` items, or persist the flag. Size: small.

#### S4-11 A new `http.Transport` per request when a proxy is set (image fetch, proxy status poll); idle connections never expire
- **Category:** performance · **Severity:** low · **Confidence:** confirmed
- **Merged:** S2-11
- **Where:** `backend/internal/imagefetch/imagefetch.go:50-59`; `backend/internal/api/proxy_handler.go:62-71` (polled every 30 s by every open tab)
- **Scenario:** Each ghost thumbnail, image download, preview and proxy-status poll builds a Transport with `IdleConnTimeout` 0. The keep-alive connection and its goroutines stay parked in a Transport nobody reuses, until the far end drops them. The custom transport also loses the default dial and TLS timeouts.
- **Suggested fix:** Cache one Transport per proxy URL (cloned from `http.DefaultTransport`), or set `DisableKeepAlives`. Size: tiny.

---

## Low confidence / needs a human look (merged)

- **Trim preview not bound to an item:** `backend/internal/api/trim_handler.go:182-191`. Accept takes any valid `.trim-preview-*` path, so a crafted request can overwrite item B with item A's trimmed preview. (S1)
- **Unvalidated thumbnail bytes:** `backend/internal/api/thumbnail_handler.go:497-503,555-602`. SetLibraryThumbnail writes arbitrary decoded bytes and updates the DB before tier generation validates them. Non-image bytes leave a broken thumbnail and an already-deleted enhancement original. (S1)
- **Wrong gallery extension:** `backend/internal/api/thumbnail_gallery_handler.go:31-34`. `readCurrentThumbnail` labels every thumbnail `.jpg`, so png/webp image items land in the gallery with the wrong extension. (S1)
- **Collection `rootPath` change moves nothing:** `backend/internal/api/collections_handler.go:211-226`. Changing it affects new downloads only; nothing moves on disk. FEATURES.md doesn't say if that's intended. (S1)
- **Collection PATCH is a full replace:** same location. A client omitting `isPrivate`/`browseAsShow`/`artistId` clears them. (S1)
- **Serial bulk thumbnail fetch:** `backend/internal/api/ghost_handler.go:121-151`. BulkFetchLibraryThumbnails runs one yt-dlp per id inside the request, with no cap or dedupe. (S1)
- **Double redownload race:** `backend/internal/api/library_handler.go:924-934`. The active-download check and the enqueue are not atomic, so two quick clicks can queue two redownloads. (S1)
- **Duration 0 after trim:** `backend/internal/api/trim_handler.go:194-198`. A failed ffprobe after accept stores `duration=0` instead of NULL. (S1)
- **Ghost create retry duplicates:** `backend/internal/api/ghost_handler.go:51-67`. Ghost create returns 500 on a tagging failure but keeps the row, so a client retry makes a second ghost. (S1)
- **No upper bound on worker count:** `backend/internal/api/dto.go:1060` (+ `backup_handler.go:146-150`). `maxConcurrentDownloads` has no max, so a typo or imported file with 10,000,000 spawns that many workers. (S2, S4)
- **Serial ffprobe in import scan:** `backend/internal/api/import_handler.go:61-63`. `ScanImport` runs one ffprobe per untracked file inside the request. (S2)
- **Concurrent import of one file:** `backend/internal/api/import_handler.go:131-139`. The "already imported" check is a full `ListPaths`, and there is no UNIQUE on `library.path`, so two concurrent imports can insert the same file. (S2)
- **N+1 in subscriptions and bulk frame match:** `backend/internal/api/subscriptions_handler.go:127-138,292-305` and `backend/internal/api/framematch_handler.go:136-149`. Both have N+1 queries; they only matter at large sizes. (S2, S3)
- **500 on bad backup data:** `backend/internal/api/backup_handler.go:97-104` / `backup/envelope.go:85-88`. Bad base64 in an uploaded backup returns 500 instead of 400. (S2)
- **Restore skips subscription catch-up:** `backend/internal/api/backup_handler.go:146`. A restore that re-enables subscriptions doesn't trigger the catch-up check that `UpdateSettings` does. (S2)
- **Backup upload cap:** `backend/internal/api/router.go:80` vs `backup/auto.go`. On-disk backups have no size cap but uploads are capped at 50 MB, so a large library's backup may not be importable. (S2)
- **Unsanitized collection segments on restore:** `backend/internal/backup/library.go:530-536` → `repository/collections_repo.go:310-316`. Collection segments from an uploaded bundle are not sanitized (`..`, `a/b`). pathsafe still contains downloads, so the impact looks limited to broken collections. (S2)
- **Restore bypasses settings validation:** `backend/internal/backup/settings.go:246-257`. `ApplySettingsBundle` writes arbitrary keys outside the PATCH validators and not in a transaction. (S5)
- **FTS rewrite on every update:** `database/migrations/000014_library_search.up.sql:289`, `000044…:607`. The `library_au` trigger has no column list, so every playback-position heartbeat and tier update rewrites the FTS row (~3 ms each). (S3)
- **Sessions never expire from the DB, tokens in plaintext:** `backend/internal/repository/users_repo.go:152-237`. Expired sessions are never deleted, and tokens are stored in plaintext, so a DB copy yields live sessions; hash them with SHA-256. (S3)
- **Comma in subscription tags:** `backend/internal/repository/subscriptions_repo.go:65-74`. Subscription tags are comma-joined, so a tag name containing `,` splits into two tags. (S3)
- **Orphaned backup files:** `backend/internal/repository/backup_history_repo.go:109-114`. Per-row deletes with no transaction; an error drops the returned slice and orphans files. (S3)
- **Collection delete race:** `backend/internal/repository/collections_repo.go:245-266`. The child-count + DELETE pair is not atomic, so a concurrent child insert shows up as a generic 500 instead of `ErrHasChildren`. (S3)
- **`synchronous=FULL` under WAL:** `backend/internal/db/db.go:17`. NORMAL is the usual WAL setting. (S3)
- **"current" playlist mode on pure playlist URLs:** `backend/internal/api/downloads_batch.go:184-191`. For a pure playlist URL, yt-dlp downloads every entry and only the last becomes an item. (S4)
- **Unescaped Jellyfin item id:** `backend/internal/jellyfin/client.go:37`. The id goes into the URL path unescaped (admin-set value). (S4)
- **`%` in output names:** `backend/internal/downloader/args.go:38-40`. Literal names and titles keep `%`, so a remote title with `%(…)s` is expanded by yt-dlp. Paths stay contained. (S4)
- **PNG bytes in a `.jpg`:** `backend/internal/thumbnailenhance/enhance.go:752`. A1111 PNG output is written into a `.jpg` sidecar; check whether consumers sniff the content. (S5)
- **Prune vs tier-generation race:** `backend/internal/strayfiles/strayfiles.go:222-233`. `pruneEmptyParents` can race tier generation for the same dir (a tiny window). (S5)
- **Case-sensitive stray matching:** `backend/internal/strayfiles/strayfiles.go:331,470`. Matching is case- and separator-sensitive (Windows dev only). (S5)
- **Untracked enhancement goroutines:** `backend/internal/api/thumbnailenhance_handler.go:210,319,340`. Every Enhance/Sharpen click spawns an untracked goroutine queued on `enhanceMu`, with no cancel. (S5)
- **Backfill progress shows 0:** `backend/internal/imagebackfill/manager.go:103-122`. Progress is published only after each pass, so polling shows 0 during the library pass. (S5)
- **Logout has no CSRF check:** `backend/internal/api/auth_handler.go:253`. SameSite=Lax limits this to same-site pages, so it's a nuisance at most. (S6)
- **WebSocket read limit and shutdown leak:** `backend/internal/ws/client.go:27-43` and `hub.go:47-53`. No `SetReadLimit`; at shutdown each `readPump` blocks forever on `unregister`. (S6)
- **pathsafe and symlinks:** `backend/internal/pathsafe/pathsafe.go:16-45`. No symlink resolution, so a symlinked dir inside `MEDIA_ROOT` escapes the root (needs host access to create). Root-equivalent inputs (`""`, `"."`, `a/..`) return the root itself; confirm that the deleting callers (`library_cleanup.go:118`, `strayfiles.go:184`) never pass one. The package has no tests. (S6)
- **Windows reserved names:** `backend/internal/fsutil/fsutil.go:25-30`. `SanitizeFilename` doesn't reject `CON`, `NUL`, `COM1` (Windows hosts only). (S6)
- **Passwords over 72 bytes:** `backend/internal/api/dto.go:35-38,135-138`. These return 500 with bcrypt's error text instead of 400. (S6)
- **Unknown `/api` paths:** `backend/internal/api/static.go:17-40`. An unknown `/api/...` path returns the SPA with 200 instead of a JSON 404. (S6)
- **Docs drift:** `docs/architecture.md:121-122` omits `/api/version` (public) and `/local-images/*` (protected) from the route lists; `docs/api.md:18-20` is correct. (S6)

---

## What was checked and found clean

### S1: API handlers A
- All SQL reached from these handlers uses placeholders; sort columns go through the `librarySortColumns` allowlist and the direction is normalized.
- User-supplied paths go through `pathsafe.ResolveUnderRoot`:
  - move folder (after `SanitizeRelativePath`)
  - collection root segments
  - cover candidates
  - `resolveImageSourceBytes`
  - `/api/image`
  - trim preview paths (also pinned to `TrimTmpDir`)
  
  Rename uses `SanitizeFilename`.
- Ghosts: delete-file, move, rename, trim, probe, thumbnail write and gallery apply all reject `Path == ""` (the only gaps are S1-8 and the image case in S1-1).
- Duplicate ids in batch inputs are safe for bulk delete, delete-file, redownload and cancel. Bulk deletes are transactional, and files are touched only after commit.
- No N+1 in ListLibrary, compare list or ListCollections; privacy is computed once per request via `ItemResponder`.
- Bodies are capped at 50 MB globally, bulk download at 200 items, frame candidates at 50. Internal fields (`TargetLibraryItemID` etc.) are `json:"-"`. Gallery actions check ownership.

### S2: API handlers B
- Session tokens are 32 bytes of crypto/rand, never returned by `ListSessions`; revoke-by-id is scoped to the user.
- Recovery-code check is constant-time over all hashes; TOTP replay is blocked atomically; `EnableTOTP` is transactional and guarded; the challenge is consumed only after verification.
- Rate limiting covers login, 2FA, password change and disable/regenerate; failures log address and label only; `X-Forwarded-For` is untrusted without `TRUSTED_PROXIES`.
- `writeCookiesFile` writes `0600` and removes the file on empty.
- Backup download, preview, restore and delete resolve filenames through pathsafe; scrypt parameters are fixed (not chosen by the upload); library restore is one transaction.
- `serveSPA` cannot escape the static dir; gzip skips media, range and non-200 responses.
- The access log masks `?token=`, and the panic dump masks auth headers; host actions never return their URL or token.
- Preferences and table layouts use allowlists, size caps and per-user scoping; bulk tag and artist deletes are transactional.

### S3: Persistence
- Dynamic SQL is allowlisted or placeholder-only (sort map, `?` repeats, constant fragments). The enhancement-history LIKE escapes its input; FTS input is quoted per word.
- `foreign_keys`, WAL and `busy_timeout=5000` are active on the pool connection (verified). `NoTxWrap` is correctly reasoned for the FK-off rebuilds.
- FTS triggers are recreated after the 044 rebuild.
- Every `rows` loop checks `Err()` and closes.
- No handler or repo transaction calls a non-tx repo inside the tx (which would self-deadlock with one connection), apart from S3-1's mutex shape.
- Timestamps are written consistently as UTC `2006-01-02 15:04:05`; ids and sizes are int64.
- 2FA writes are transactional; TOTP step and recovery-code consumption are atomic.

### S4: Download pipeline
- Every yt-dlp and ffmpeg call uses `newTreeKillCmd` (process group + SIGKILL, `WaitDelay`).
- Settings values (proxy, rate limit, cookies, retries) are separate argv values after their flag; no shell anywhere.
- ffmpeg paths are absolute; the concat list escapes `'`.
- Destination folders go through pathsafe; template segments and literal names go through `SanitizeFilename`, so template subdirs cannot leave the collection root.
- NFO uses `encoding/xml` (invalid characters become U+FFFD).
- The Jellyfin token is sent only in the `X-Emby-Token` header (never in URLs or logs), with a 10 s timeout.
- `runGhosts`, `cancels` and `lastBroadcastAt` are mutex-guarded and counters atomic; `SetWorkerCount` never cancels in-flight jobs.
- `finishError` cancel/timeout/shutdown classification matches docs/architecture.md.
- `imagefetch.Fetch` writes temp + rename; `Open` enforces a deadline and a Content-Type allowlist; non-HTTP schemes are rejected.
- `importer.Scan` skips dot-dirs, and the ignore filter matches by prefix correctly.

### S5: Background and media jobs
- `imagebackfill.Manager` status is mutex-guarded and `Start` is single-flight; `framematch.JobStore` returns copies under its lock.
- `imageproc.Resizer` coalesces in-flight builds on a detached context, bounds ffmpeg with a semaphore, publishes via temp + rename, cleans partial tiers, and applies a 30 s timeout.
- `RunDueChecks` uses TryLock (overlapping sweeps are skipped); `enhanceOne` is serialized with a re-probe guard.
- Stray-file delete:
  - re-scans server-side
  - resolves through pathsafe
  - requires an exact match with a fresh stray entry
  - doesn't follow symlinks
  - has a 10-minute age guard
  - skips `.part` files during active downloads
  - never prunes MediaRoot dirs
- Backup file paths go through pathsafe; there is no archive extraction, so zip-slip does not apply. `ApplyLibraryBundle` is one transaction; crypto is scrypt N=2^15 + AES-256-GCM with random salt and nonce.
- All SQL uses placeholders; the ticker goroutine and `RunQueue` exit on context cancel; subprocesses use `exec.CommandContext`.

### S6: Security and infrastructure
- **Route protection:** every route in `router.go` was enumerated (there are no other registrations: no `pprof`, `ServeMux` or extra `Static`).
  - Public: health, version, auth status, setup, login, login/2fa, logout.
  - Everything else under `/api` is behind `RequireAuth` + `RequireCSRF`, with CSRF failing closed.
  - Feature gates are present on all Subscriptions (10), Frame Matching (6), Compare list (4) and File Import (2) routes.
  - `/media-files/*`, `/local-images/*` and `/ws` use `RequireAuth` (GET/HEAD only).
  - The only deviations are listed above: S6-2, S6-3, S6-4, S6-5, S6-6, plus the logout CSRF note.
- CSRF compare is constant-time and independent of the session token; bearer and query-token requests skip it correctly.
- The cookie is HttpOnly + SameSite=Lax; `?token=` works for GET/HEAD only and is redacted in logs.
- Trusted proxies default to none and `TRUSTED_PROXIES` is validated.
- The rate limiter is bounded at 10k IPs × 10 timestamps; the challenge store is capped at 1000 with tokens stored hashed.
- TOTP: ±1 step window, atomic anti-replay. Recovery codes use a keyed HMAC, constant-time compare and atomic spend. Secrets at rest use AES-GCM with an AAD, and the key file is `0600`.
- CORS is an exact-origin allowlist with no credentials and rejects wildcards.
- Host actions use HTTP only, with no shell; they are env-configured, redact errors, cap reads at 4 KB and have a timeout.
- admincmd never takes the password as an argument; reset and disable-2FA are transactional and drop all sessions.
- `ReadHeaderTimeout` is set, with a 50 MB body cap. `features.Enabled` fails open as documented. `fsutil.RenamePair` rolls back; `SanitizeRelativePath` drops `..`.
- The WebSocket hub drops slow consumers without blocking broadcast.
