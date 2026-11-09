# API

Base URL: same origin as the web UI (the Go binary serves both the API and the built frontend).
This is a **solo-admin app** — there is never more than one user account. All timestamps are
RFC3339. Unless noted, error responses are `{"error": "..."}`.

All JSON API routes live under `/api` — this is deliberate, not a style choice: the frontend has
client-side routes named `/downloads`, `/library`, `/collections`, etc. too, and without the prefix
a hard refresh (or a shared link) on those pages would hit the API route instead of the app shell,
since Gin matches registered routes before falling back to serving `index.html`. `/media-files` and
`/ws` stay unprefixed since no frontend route shares those names. An unknown `/api/*` route answers
`404` `{"error": "not found"}` (never the app shell); unknown `/media-files/*`, `/local-images/*`
and `/ws/*` paths answer a plain `404`.

## Bulk endpoints

Several actions only exist as `POST .../bulk-<action>` endpoints that take a list. There is no
single-item twin: a single-item action in the UI sends a list with **one** element to the same
endpoint. Rules shared by every one of them:

- **Cap.** At most **1000** ids / items per request; more is `400`. An empty list is `400`, as is a
  malformed body. Duplicate ids are dropped silently (except `POST /api/library/bulk-update`, where a
  duplicate id is a `400`: the two changes would be ambiguous).
- **All-or-nothing** endpoints (deletes, gallery favorite/delete, entry seen/unlink) run in **one
  transaction**. Ids that do not exist are ignored (deleting something already gone is a success), and
  the response counts what really changed: `{"deleted": N}` or `{"updated": N}`. When something is
  *blocked*, nothing changes and the answer is `409 {"error": "...", "blockedIds": [ ... ]}`. Files
  (backups, gallery images) are removed only after the commit, best effort.
- **Per-item-result** endpoints (`library/bulk-update`, `history/bulk-retry`,
  `subscriptions/:id/entries/bulk-add`) process each item independently, in request order, because the
  work includes disk renames, remux scheduling or enqueueing that a transaction cannot undo. The HTTP
  status is `200` whenever the request itself is valid:
  ```json
  { "results": [ { "id": 5, "ok": true }, { "id": 7, "ok": false, "status": 409, "error": "..." } ],
    "succeeded": 1, "failed": 1 }
  ```
  A failing item does not stop the rest. A success may carry `downloadId` (the queued download) or
  `libraryItemId` (the created ghost). For the entry endpoint `id` is the entry's source id (a string).
  The loop runs on a context that survives the client disconnecting (bounded to 2 minutes), so closing
  the tab cannot leave half a batch undone and unreported. Enqueueing never waits for a free worker (the
  queue is unbounded), so a request of up to 1000 items answers promptly whatever is running. The one
  enqueue failure that is not about the item itself is the server shutting down: every remaining item then
  fails with status `503` ("server is shutting down; ...") and no download row is created for it.

### Replaced single-item endpoints

**Breaking change:** the single-item endpoints below were removed (they now answer `404`). Scripts
must use the bulk endpoint with a one-element list.

| Removed | Use instead |
|---|---|
| `DELETE /api/downloads/:id` | `POST /api/downloads/bulk-delete` `{"ids":[..]}` |
| `PATCH /api/library/:id` | `POST /api/library/bulk-update` `{"items":[{"id":1,"changes":{..}}]}` |
| `DELETE /api/history/:id` | `POST /api/history/bulk-delete` `{"ids":[..]}` |
| `POST /api/history/:id/retry` | `POST /api/history/bulk-retry` `{"ids":[..]}` |
| `DELETE /api/subscriptions/:id` | `POST /api/subscriptions/bulk-delete` `{"ids":[..]}` |
| `POST /api/subscriptions/:id/entries/:sourceId/add` | `POST /api/subscriptions/:id/entries/bulk-add` `{"sourceIds":[..],"mode":".."}` |
| `POST /api/subscriptions/:id/entries/:sourceId/seen` | `POST /api/subscriptions/:id/entries/bulk-seen` `{"sourceIds":[..]}` |
| `POST /api/subscriptions/:id/entries/:sourceId/unlink` | `POST /api/subscriptions/:id/entries/bulk-unlink` `{"sourceIds":[..]}` |
| `DELETE /api/backup/history/:id` | `POST /api/backup/history/bulk-delete` `{"ids":[..]}` |
| `PATCH /api/library/:id/thumbnail/gallery/:galleryId` | `POST /api/library/:id/thumbnail/gallery/bulk-favorite` `{"galleryIds":[..],"isFavorite":true}` |
| `DELETE /api/library/:id/thumbnail/gallery/:galleryId` | `POST /api/library/:id/thumbnail/gallery/bulk-delete` `{"galleryIds":[..]}` |

Unchanged: `POST .../entries/:sourceId/link`, `POST /api/subscriptions/:id/check`, saving to and applying
from the thumbnail gallery, `POST /api/history/clear`, `POST /api/downloads/clear-log`.

## Auth and CSRF

- **Session**: an opaque 64-char hex token in cookie `packrat_session` (`HttpOnly`, `SameSite=Lax`,
  `Secure=false` — deliberate, since the app is commonly run over plain HTTP on a LAN). 30-day
  expiry, validated server-side against a sessions table — not a signed/stateless token.
- **`RequireAuth`** gates every `/api/*` route except `/api/health`, `/api/version` and
  `/api/auth/{status,setup,login,login/2fa,logout}`, and also protects `/media-files/*`,
  `/local-images/*` and `/ws`. Missing/invalid session → `401`.
- **CSRF**: double-submit cookie. Cookie `packrat_csrf` (`HttpOnly=false` so JS can read it) holds
  its own random value (32 bytes from `crypto/rand`, hex), generated per web login/setup/2FA login and
  set alongside the session cookie with the same `SameSite`/`Secure`/path/lifetime; it is cleared with
  it on logout and when you revoke your own session. It is **never** the session token or derived
  from it, because script can read it and the session cookie is `HttpOnly` precisely so it can't.
  Every mutating request (anything but GET/HEAD/OPTIONS) under the authenticated `/api` group must
  echo that value back in an `X-CSRF-Token` header (compared in constant time), or the request gets a
  `403`. **Healing:** sessions created before this change still have a CSRF cookie equal to their
  session token; the first cookie-authenticated `GET`/`HEAD` (in practice `GET /api/auth/status` on
  page load) replaces it with a fresh random value via `Set-Cookie`, with no re-login. Mutations never
  rotate it. The web client replays a mutation once if the cookie changed under it and it got a `403`.
- **Bearer tokens (desktop client)**: the web UI uses the cookies above; a cross-origin client (the
  desktop app) can't rely on them, so `RequireAuth` also accepts the same session token as
  `Authorization: Bearer <token>` — and, for **GET/HEAD only**, as a `?token=` query parameter, which
  exists for `<img>`/`<video>`/WebSocket URLs that can't set headers. Credentials are tried in the
  order bearer → cookie → query; the first valid one wins. A request authenticated by bearer or query
  token **skips the CSRF check** (nothing ambient for a forged request to ride on); a cookie-
  authenticated request is checked exactly as before, whatever other headers it carries. The access
  and panic-recovery logs redact `?token=` (and `?password=`, `?pass=`, `?secret=`) values and the `Authorization`, `Cookie` and `X-CSRF-Token`
  headers.
- **Getting a token**: send `X-Client: desktop` on `POST /api/auth/login` or `/api/auth/setup`. The
  response is then `200 {"token":"..."}` and **no cookies are set**; without the header the response
  is the usual `204` + cookies. `GET /api/auth/status` and `POST /api/auth/logout` honor a bearer
  token too (logout deletes that session server-side). The desktop app stores the token client-side
  in the OS keychain (no API change; see `desktop/README.md`).
- **CORS**: origins listed in `CORS_ALLOWED_ORIGINS` (comma-separated, no wildcard; default
  `tauri://localhost,http://tauri.localhost,https://tauri.localhost`, i.e. the desktop app) may call
  the API cross-origin. Allowed: `GET/HEAD/POST/PATCH/PUT/DELETE`, headers `Authorization`,
  `Content-Type`, `X-CSRF-Token`, `X-Client`, `Range`; `Access-Control-Allow-Credentials` is never
  sent. Requests with no `Origin` header (the same-origin web UI) or an unlisted one get no CORS
  headers at all.
- **First run**: `GET /api/auth/status` returns `{setupRequired, authenticated}`. While
  `setupRequired`, the client shows a setup wizard that `POST`s `/api/auth/setup` once; after that,
  setup always `409`s — there is no way to add a second user.

## Health

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | public |

`200 {"status":"ok"}`, or `503 {"status":"unhealthy","error":"..."}` on a database ping failure.

## Version

| Method | Path | Auth |
|---|---|---|
| GET | `/api/version` | public |

`200 {"version": "0.18.2", "latestVersion": "0.18.2" | null, "updateAvailable": false}`. `version` is
this build's release version (`"dev"` for a build that wasn't made by the release pipeline).
`latestVersion` is the newest GitHub release, looked up best effort — `null` when the lookup fails —
through a process-wide cache (one GitHub call at most per hour, retried after 5 minutes following a
failure, concurrent requests share one call), and `updateAvailable` is `version != latestVersion`, always `false` for a `dev` build. The desktop app
reads it to compare its own version with the server's (see `docs/FEATURES.md` → Desktop app).

## Auth

| Method | Path | Auth |
|---|---|---|
| GET | `/api/auth/status` | public |
| POST | `/api/auth/setup` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/login/2fa` | public |
| POST | `/api/auth/logout` | public |
| PATCH | `/api/auth/password` | session + CSRF |
| GET | `/api/auth/sessions` | session |
| DELETE | `/api/auth/sessions/:id` | session + CSRF |
| POST | `/api/auth/sessions/revoke-others` | session + CSRF |
| GET | `/api/auth/preferences` | session |
| PATCH | `/api/auth/preferences` | session + CSRF |
| GET | `/api/auth/table-layouts` | session |
| PUT | `/api/auth/table-layouts/:tableId` | session + CSRF |
| DELETE | `/api/auth/table-layouts/:tableId` | session + CSRF |
| GET | `/api/auth/2fa` | session |
| POST | `/api/auth/2fa/setup` | session + CSRF |
| POST | `/api/auth/2fa/enable` | session + CSRF |
| POST | `/api/auth/2fa/disable` | session + CSRF |
| POST | `/api/auth/2fa/recovery-codes` | session + CSRF |
| GET | `/api/auth/security-notice` | session |
| POST | `/api/auth/security-notice/ack` | session + CSRF |

- **`POST /api/auth/setup`** — `{ "username": "...", "password": "min 8 chars" }`. Only succeeds
  while zero users exist (`409` otherwise, also when several calls arrive at once). Creates the user, sets both cookies, `204`.
- **`POST /api/auth/login`** — `{ "username": "...", "password": "..." }`. Wrong username *or*
  password both return `401 {"error":"invalid username or password"}` — never reveals which was
  wrong. `204` on success, sets both cookies (desktop: `200 {"token"}`, see above). **If the account
  has 2FA on**, a correct password returns `200 {"twoFactorRequired":true,"challengeToken":"...",
  "expiresInSeconds":300}` instead — no cookie and no token, for the desktop client either — and the
  login finishes at `POST /api/auth/login/2fa`.
- **`POST /api/auth/login/2fa`** — `{ "challengeToken": "...", "code": "123456" }` or
  `{ "challengeToken": "...", "recoveryCode": "K7F2-9QXM" }` (exactly one of the two; recovery codes
  are case/dash/space-insensitive). Success is exactly like a normal login (`204` + cookies, or
  `200 {"token"}` with `X-Client: desktop`). The challenge is single use and expires after 5 minutes;
  `401 {"error","challengeExpired":true}` means it is gone (expired, used, or 5 wrong codes) and the
  password must be entered again; a wrong code is `401 {"error":"invalid code"}`.
- **Rate limiting (all credential endpoints)** — only *failures* count. Per IP: 10 failures / 15 min,
  then `429` for that IP until the window clears (correct attempts too). Globally: 30 password or 10
  code failures per hour start a cool-down for everyone on that step (15 min, doubling to a 4 h cap).
  Applies to login, `/login/2fa`, `PATCH /auth/password`, and the `2fa/*` endpoints below that take a
  password or code. Response: `429`, header `Retry-After: <seconds>`, body
  `{"error":"too many attempts, try again later","retryAfterSeconds":<n>}`. The client IP is the
  connection address; `X-Forwarded-For` is only honored from `TRUSTED_PROXIES`.
- **`POST /api/auth/logout`** — no body. Deletes the session row server-side (a replayed old cookie
  stops working immediately) and clears both cookies. `204`, idempotent even with no session.
- **`PATCH /api/auth/password`** — `{ "currentPassword": "...", "newPassword": "min 8 chars" }`.
  Requires the *current* password even though the route is already session-protected, so a
  hijacked/left-open session can't lock out the real owner. `401` if current password is wrong,
  else `204`. All other sessions of the user (including desktop tokens) are signed out; the current
  one stays.
- **`GET /api/auth/sessions`** — the signed-in devices, most recently active first:
  `{ "sessions": [{ "id", "client", "ip", "userAgent", "createdAt", "lastSeenAt", "current" }] }`
  (times RFC 3339 UTC). `id` is a random, non-secret handle — the session token itself is never
  returned or logged. `client` is `web` or `desktop` (the `X-Client` header at login; `""` for a
  session created before this was recorded), `ip` is the login address (`TRUSTED_PROXIES` applies),
  `userAgent` is truncated to 256 characters, `lastSeenAt` falls back to `createdAt` until the first
  recorded activity, and `current` marks the session making the request. Expired sessions are left out.
  `last_seen_at` is written by `RequireAuth` at most once a minute per session.
- **`DELETE /api/auth/sessions/:id`** — signs that device out. `204`; `404` for an unknown id or one
  that isn't yours. Revoking the session the request itself uses behaves like logout (both cookies
  are cleared too).
- **`POST /api/auth/sessions/revoke-others`** — no body; signs out every session except the current
  one and returns `{ "revoked": n }` (`0` is fine).
- **`GET /api/auth/preferences`** — the signed-in account's appearance:
  `{ "theme": "system", "accent": "default" }`. Both keys are always present; a key never saved
  returns its default. `theme` ∈ `light|dark|system`, `accent` ∈ `default|blue|red|green|yellow|mono`.
- **`PATCH /api/auth/preferences`** — partial body (`{ "theme": "dark" }`); only the provided keys
  change, and the full resulting object is returned. `400` with `{ "error" }` for an unknown key, a
  non-string value or one outside the lists above (nothing is applied), and for an empty body
  (`{}` is not a no-op). The account always comes from the session, never the request. These are
  per account and not part of the global Settings or any backup.
- **`GET /api/auth/table-layouts`** — every saved table layout of the signed-in account in one response:
  `{ "layouts": { "<tableId>": <layout>, ... } }` (`{ "layouts": {} }` when none). The client fetches
  this once and caches it.
- **`PUT /api/auth/table-layouts/:tableId`** — the body is the layout; it replaces the whole layout of
  that table and the stored (canonical) layout is returned. A layout is a JSON object with **only** these
  fields (unknown fields are rejected): `v` (required, must be `1`), `sort` (optional
  `{ "key": <colKey>, "dir": "asc"|"desc" }`, both required; an absent `sort` means the table's default order, which
  the client defines per table, so a layout saved without `sort` keeps working), `hidden` (optional array of `<colKey>`,
  unique, at most 64) and `widths` (optional object `<colKey>` → integer 24–2000, at most 64 entries; the web UI stores only overrides of the table's default column widths, a column at its default width has no entry).
  `<colKey>` matches `^[A-Za-z0-9_-]{1,64}$`; `tableId` matches `^[a-z0-9][a-z0-9-]{0,63}$`. The body is
  at most 4 KB. `400` with `{ "error" }` for any violation (a non-object body, a wrong type, a fractional
  number, an invalid `tableId`, an oversized body) and nothing is stored. Canonical form: fixed field
  order (`v`, `sort`, `hidden`, `widths`), `hidden` sorted, `widths` keys sorted, and empty or `null`
  optional fields omitted. At most 100 tables can have a saved layout per account: saving a *new*
  `tableId` beyond that is `409`; updating an existing one is always allowed.
- **`DELETE /api/auth/table-layouts/:tableId`** — `204`, also when nothing was saved for that table
  (idempotent); `400` for an invalid `tableId`.
  Table layouts are per account (always the session's, never a request value, and the same on the
  desktop bearer-token path) and not part of the global Settings, exports or any backup.
- **`GET /api/auth/2fa`** — `{ "enabled": bool, "recoveryCodesRemaining": n }`.
- **`POST /api/auth/2fa/setup`** — no body; creates a *pending* secret (replacing any earlier one) and
  returns `{ "secret": "<base32>", "otpauthUrl": "otpauth://totp/Packrat:<username>?..." }`. `409` if
  2FA is already enabled. Nothing changes for logins until it is confirmed.
- **`POST /api/auth/2fa/enable`** — `{ "password", "code": "123456" }`: the current password (checked
  like the other 2FA endpoints and throttled with the password budget), then the code is checked
  against the pending secret; turns 2FA on and returns `{ "recoveryCodes": [10 × "XXXX-XXXX"] }` — the
  **only** time they are shown. `400` no password, `401` wrong password (`"incorrect password"`) or
  bad code, `409` no pending secret / already enabled.
- **`POST /api/auth/2fa/disable`** — `{ "password", "code" | "recoveryCode" }`; clears the secret and
  recovery codes. `204`; `401` for a wrong password or code.
- **`POST /api/auth/2fa/recovery-codes`** — `{ "password", "code" }`; replaces the whole set (old codes
  stop working) and returns `{ "recoveryCodes": [...] }`.
- **`GET /api/auth/security-notice`** — `{ "failedAttempts": n, "since": "<RFC 3339>",
  "lastAttemptAt": "<RFC 3339>" | null }`: failed password/code attempts since the owner last
  acknowledged (or since the account was created). **`POST /api/auth/security-notice/ack`** — no body,
  `204`; resets the count.

## Downloads

| Method | Path | Description |
|---|---|---|
| POST | `/api/downloads` | Queue a single download |
| GET | `/api/downloads` | List the live queue (all statuses, not paginated) |
| POST | `/api/downloads/preview` | Fetch yt-dlp metadata without queuing anything |
| GET | `/api/downloads/preview-image` | Proxy a single external image through the backend |
| POST | `/api/downloads/playlist` | Queue a playlist URL — server expands entries |
| POST | `/api/downloads/batch` | Queue many independent URLs in one call |
| POST | `/api/downloads/:id/cancel` | Cancel a queued/in-flight download |
| POST | `/api/downloads/bulk-delete` | Remove terminal downloads' queue-history rows (all-or-nothing) |
| POST | `/api/downloads/clear-log` | Delete every terminal download row now |

Every endpoint that queues a download (`POST /api/downloads`, `/playlist`, `/batch`, library redownload,
history retry, subscription entry add) answers `503 {"error": "server is shutting down; ..."}` — or, in
a per-item result, an item with `"status": 503` (in `POST /api/downloads/batch` and `/playlist`, an item
in `failed` with that message) — while the server is shutting down; no row is created. Queuing itself
never blocks on busy workers: the response comes back as soon as the rows exist.

### `POST /api/downloads` — body

```json
{
  "url": "https://www.youtube.com/watch?v=abc123",
  "collectionId": 4,
  "folder": "",
  "filename": "",
  "downloadType": "video",
  "quality": "1080p",
  "audioFormat": "mp3",
  "title": null,
  "artistId": null,
  "year": null,
  "seasonNumber": null,
  "sequenceNumber": null,
  "filenamePrefix": null,
  "filenameTemplate": null,
  "tags": ["music", "live"],
  "generateNfo": true
}
```

`url` (must be a URL) and `downloadType` (`video`|`audio`|`image`) are required; everything else is
optional. Notes:

- If `collectionId` is set and `quality` is omitted, the collection's `defaultQuality` is used;
  else the app-wide `defaultQuality` setting; else `"best"`.
- `audioFormat` defaults to `"mp3"` when `downloadType=audio` and it's omitted. Every path that can
  queue an audio download (this endpoint, batch/playlist, and subscriptions) applies this same
  default — yt-dlp rejects an empty `--audio-format` outright.
- `folder`/`collectionId` are validated with path-traversal protection *synchronously* — an
  invalid folder or unknown collection is a `400`, not a later async failure.
- `title`/`artistId`/`year`/`seasonNumber`/`sequenceNumber`/`filenamePrefix` are **overrides
  applied once the download completes**, taking priority over whatever yt-dlp reports.
- **Filename** — the final name is chosen in this order: a literal `filename` (used as given,
  sanitized) beats `filenameTemplate`, which beats `filenamePrefix` (`"<prefix> <title>"`); with none
  set, yt-dlp's own `%(title)s` naming applies. If neither `filename` nor `filenameTemplate` is
  given and the request has a `collectionId`, the collection's own `filenameTemplate` is used (see
  Collections).
- `filenameTemplate` — a template such as `{artist}/{title}` or `{title} S{season:02}E{sequence:02}`,
  resolved when the download runs. Tokens: `{title}` (the effective title, i.e. your `title`
  override or yt-dlp's), `{uploader}` (alias `{channel}`), `{date}` (yt-dlp's upload date,
  `YYYYMMDD`), `{artist}` (the `artistId` override's name), `{year}` (the `year` override, else the
  upload year), `{season}`, `{sequence}`, `{collection}` (the collection's name). A token that has no
  value becomes empty text; there is no conditional logic. A token may carry a modifier after a
  colon: digits (`{season:02}`) zero-pad a numeric value to that width; anything else
  (`{artist:.}`) replaces the runs of spaces inside the value with that text (`Rick.Astley`). A `/`
  in the template makes subfolders inside the collection's folder; every segment is sanitized on its
  own, and segments that end up empty (or `..`) are dropped.
- `tags` are applied to the resulting library item on completion (created if missing).
- Response: `201 {"id": 42}`.
- **`downloadType=image`**: for a direct link to a single image file — no yt-dlp involved at all,
  no gallery/multi-image support. Skips the metadata-fetch step entirely (the title falls back to
  the URL's last path segment, then the raw URL). The plain HTTP GET is routed through the
  `ytdlp_proxy` setting exactly like yt-dlp itself (see Proxy, below). The downloaded file is
  optionally re-encoded per the `imageConvertFormat` setting (Settings → Downloads → Images; global only, no
  per-download override) and doubles as its own thumbnail — no separate sidecar. Quality/audio
  fields are ignored. A URL whose response isn't a recognized `image/*` Content-Type fails fast
  instead of writing a misleadingly-named file.

### `GET /api/downloads` — no params

Returns every queue row (any status), each merged with live in-memory progress when actively
running. It is never truncated. The query leaves out the output tails and the yt-dlp command (the
response has never carried them), so its cost follows the row count, not ~8 KB per row; the response
is unchanged:

```json
{
  "id": 42, "url": "https://youtube.com/watch?v=abc123", "collectionId": 4,
  "collectionName": "Music Videos", "folder": "", "filename": "",
  "downloadType": "video", "quality": "1080p", "audioFormat": null,
  "status": "downloading", "title": "Some Video", "uploader": "Some Channel",
  "duration": 214, "thumbnail": "Music Videos/Some Video.jpg", "errorMessage": null,
  "createdAt": "2026-07-19T10:00:00Z", "updatedAt": "2026-07-19T10:00:05Z",
  "completedAt": null, "percent": 43.2, "speedBytesPerSec": 1048576,
  "etaSeconds": 12, "downloadedBytes": 5242880, "totalBytes": 12058624,
  "blurred": false
}
```

`status` is one of `queued`, `fetching_metadata`, `downloading`, `processing`, `completed`,
`failed`, `cancelled`, `interrupted`. `percent` is forced to `100` once `status=completed`.
`blurred` is true if privacy is enabled and the download's collection (or an ancestor) is private
(collection only — a queued download has no tags yet).

### `POST /api/downloads/preview`

Body: `{ "url": "https://..." }`. Fetches yt-dlp metadata for the New Download dialog's pre-submit
card — a fetch failure returns `422` and the frontend treats it as non-fatal. For a single-video
URL, also checks for a duplicate already in the library (by URL/video ID). A `duplicate` is
`{libraryItemId, title, thumbnail, downloadedAt, blurred}`; `blurred` is the library item privacy rule
(private collection, artist or tag, privacy on) applied to the matched item, and is `false` with the
privacy switch off. Clients show a blurred match's title hashed and hide its thumbnail.

```json
{
  "title": "Some Video", "uploader": "Some Channel", "uploadDate": "20240131", "duration": 214,
  "thumbnail": "https://...jpg", "resolution": "1920x1080",
  "isPlaylist": false, "playlistTitle": "", "playlistCount": 0,
  "duplicate": null
}
```

`uploadDate` is yt-dlp's `YYYYMMDD` upload date (`""` if unknown) — it feeds the `{date}` token in the
filename-template preview. For a playlist URL, `isPlaylist=true` and only `playlistTitle`/`playlistCount`
are populated.

### `GET /api/downloads/preview-image?url=...[&kind=image|thumbnail]`

Streams `url`'s response straight back through — same Content-Type allowlist and `ytdlp_proxy`
routing as the `downloadType=image` fetch above. Backs the New Download dialog's live preview
`<img>` for **both** an image-type URL and a regular video/audio URL's yt-dlp-reported thumbnail: a
plain client-side `<img src>` pointing at the raw external URL can't honor a backend-configured
proxy, so both preview paths go through this endpoint instead of loading the external image
directly. Optional `kind` says who chose the URL: `image` (default, also when omitted) is a direct
image URL the admin typed — private/LAN addresses are allowed; `thumbnail` is the thumbnail yt-dlp
reported from the page's metadata, which the remote page controls, so loopback, link-local, private,
CGNAT and other non-public addresses (also via redirects) are refused. `400` for any other `kind`.
`422` if the fetch fails, the Content-Type isn't a recognized image type, the image is larger than
25 MB (`{"error": "fetching image: image larger than the 25 MB limit"}` when the `Content-Length`
says so; a body that outgrows the limit mid-stream is cut off), or — `kind=thumbnail` only — the
address is refused (`{"error": "thumbnail URL refused: it points at a private or non-public address"}`,
URL-free). `200` with the image bytes streamed through (`Content-Type`/size passed along) on success.

### `POST /api/downloads/playlist`

The client sends **only a URL and a mode** — the server does a fresh yt-dlp flat-playlist fetch and
resolves entries itself, never trusting a client-supplied entry list.

```json
{
  "url": "https://youtube.com/playlist?list=xyz",
  "collectionId": 4, "downloadType": "video", "quality": "1080p",
  "playlistMode": "range", "playlistStart": 5, "playlistEnd": 10,
  "skipDuplicates": true
}
```

`playlistMode` is one of:
- `"current"` — no playlist fetch; queues exactly one download for the URL as given.
- `"entire"` — every entry.
- `"range"` — 1-based inclusive `playlistStart`..`playlistEnd`; `400` if out of bounds/missing.
- `"first_n"` — first `playlistLimit` entries (clamped to playlist length); `400` if `<1`.

Expanded entries get `sequenceNumber` auto-set to their 1-based position in the filtered list, and
duplicate matching uses the real per-entry video ID. `422` if the initial playlist fetch fails.
Response: `201` with an `EnqueueResult` (see batch, below) — same shape either way.

### `POST /api/downloads/batch`

Many independent URLs — what used to be N separate `POST /api/downloads` calls, now one request
(used by the Bulk Download dialog).

```json
{
  "items": [
    { "url": "https://youtube.com/watch?v=aaa", "downloadType": "video", "collectionId": 4 },
    { "url": "https://youtube.com/watch?v=bbb", "downloadType": "audio", "audioFormat": "mp3" }
  ],
  "skipDuplicates": true
}
```

Each item is a full `CreateDownloadRequest` (same shape as `POST /api/downloads`), individually
validated. If `skipDuplicates`, each URL is checked against the library first (by URL) and skipped
rather than re-downloaded. Response `201`:

```json
{
  "queued": [ { "id": 101, "url": "https://youtube.com/watch?v=aaa" } ],
  "skipped": [ { "url": "https://youtube.com/watch?v=bbb", "title": "Old Song", "libraryItemId": 55, "blurred": false } ],
  "failed": []
}
```

A per-item enqueue failure lands in `failed` (`{url, error}`) rather than aborting the whole batch.
Each `skipped` entry carries `blurred` — the library item privacy rule applied to the matched item,
as in the duplicate warning of `POST /api/downloads/preview` — and a `reason`:
`"in_library"` (a library item matched; `libraryItemId` is set, as before) or `"duplicate_in_batch"`
(with `skipDuplicates`, an earlier entry of the same request has the same normalized URL — scheme/host
case, fragment and trailing slash ignored — or the same non-empty video id; there is no library item, so
`libraryItemId` is **absent** and `title` is the URL). The first copy is queued, later copies are skipped
and recorded in History as `duplicate` ("Duplicate within this request"). Without `skipDuplicates`
nothing changes. `POST /api/downloads/playlist` returns the same shape.

### `POST /api/downloads/:id/cancel` — no body

`204` on success. `404` unknown id, `409` if it's not in a cancellable state — including when the
download started or finished between the check and the cancel (a queued download is cancelled only while
it is still queued, so it can never be cancelled *and* run).

### `POST /api/downloads/bulk-delete`

```json
{ "ids": [1, 2, 3] }
```

Removes the downloads' log rows — distinct from cancel, which stops an in-flight job. All-or-nothing
(see [Bulk endpoints](#bulk-endpoints)): if any listed download is in an active status nothing is deleted
and the answer is `409 {"error":"cancel these downloads before deleting them","blockedIds":[4]}`.
Unknown ids are ignored. `200 {"deleted": <rows really removed>}`.

### `POST /api/downloads/clear-log` — no body

Deletes every terminal (non-active) download row regardless of age — manual complement to the
automatic retention sweep. `200 {"deleted": <n>}`.

## Library

| Method | Path | Description |
|---|---|---|
| GET | `/api/library` | List/search/filter/paginate |
| GET | `/api/library/facets` | Distinct filter values (currently: years) |
| GET | `/api/library/:id` | Fetch one item, same response shape as a row from the list endpoint |
| DELETE | `/api/library/:id` | Remove an item |
| POST | `/api/library/bulk-update` | Edit metadata of one or many items (a list of `{id, changes}`; per-item results) |
| POST | `/api/library/bulk-tags` | Overwrite tags on many items at once |
| POST | `/api/library/bulk-delete` | Delete many items at once |
| POST | `/api/library/:id/move` | Relocate to a different collection/folder |
| POST | `/api/library/:id/refresh-metadata` | Re-fetch + overwrite metadata from source |
| GET | `/api/library/:id/metadata-preview` | Read-only diff of current vs. source metadata |
| GET | `/api/library/:id/probe-metadata` | Read-only ffprobe scan of the file actually on disk |
| POST | `/api/library/:id/redownload` | Re-queue a fresh download from the source URL |
| GET | `/api/library/:id/redownload/preview-url` | Preview a *different* candidate URL before redownloading from it |
| POST | `/api/library/:id/redownload/from-url` | Redownload from a different URL, choosing which fields to overwrite |
| POST | `/api/library/:id/progress` | Record current playback position (Continue Watching) |
| POST | `/api/library/ghost` | Create a ghost (placeholder, no file) library item |
| DELETE | `/api/library/:id/file` | Delete just the file, keep the entry (becomes a ghost) |
| GET | `/api/maintenance/stray-files` | Report files on disk no DB record references (never deletes) |
| POST | `/api/maintenance/stray-files/delete` | Delete chosen stray files, re-validated per path |
| POST | `/api/library/scan-missing` | Convert any item whose on-record file is gone from disk into a ghost |
| POST | `/api/library/bulk-redownload` | Re-queue downloads for many items at once |
| POST | `/api/library/bulk-fetch-thumbnails` | Re-fetch thumbnails for many items at once |
| POST | `/api/library/bulk-delete-file` | Bulk version of `DELETE /:id/file` |
| POST | `/api/library/:id/trim/preview` | Generate a trimmed preview (original untouched) |
| POST | `/api/library/:id/trim/accept` | Overwrite the original with an already-generated preview |
| POST | `/api/library/:id/trim/discard` | Delete a generated preview without touching the original |
| GET | `/api/library/:id/trim/frames` | Decode every frame in a short window (frame-accurate picker) |
| POST | `/api/library/:id/thumbnail/redownload` | Re-fetch just the thumbnail |
| POST | `/api/library/:id/thumbnail/quick-grab` | Grab one random video frame as thumbnail |
| GET | `/api/library/:id/thumbnail/timestamps` | Pick N candidate-frame timestamps (read-only, no extraction) |
| GET | `/api/library/:id/thumbnail/candidates` | Extract N candidate frames (read-only) |
| POST | `/api/library/:id/thumbnail` | Set the thumbnail from a supplied image |
| DELETE | `/api/library/:id/thumbnail` | Remove the thumbnail |
| POST | `/api/library/:id/thumbnail/gallery` | Save an image to the item's thumbnail gallery |
| GET | `/api/library/:id/thumbnail/gallery` | List the item's saved gallery images |
| POST | `/api/library/:id/thumbnail/gallery/:galleryId/apply` | Apply a saved gallery image as the active thumbnail |
| POST | `/api/library/:id/thumbnail/gallery/bulk-favorite` | Favorite/unfavorite saved gallery images (all-or-nothing) |
| POST | `/api/library/:id/thumbnail/gallery/bulk-delete` | Remove saved gallery images (all-or-nothing) |
| POST | `/api/library/:id/thumbnail/match` | Start an ad-hoc frame-match job for this item |
| GET | `/api/thumbnail-match/:jobId` | Poll an ad-hoc frame-match job |
| POST | `/api/library/thumbnail/match/bulk` | Bulk-enqueue items onto the durable frame-match queue |
| GET | `/api/frame-match/queue` | List the frame-match working queue |
| POST | `/api/frame-match/queue/:id/accept` | Apply a resolved queue row's found frame as the thumbnail |
| DELETE | `/api/frame-match/queue/:id` | Discard/dismiss a frame-match queue row |
| POST | `/api/library/:id/nfo` | Write/overwrite the `.nfo` sidecar |
| GET | `/api/library/:id/nfo` | Read the raw `.nfo` XML |
| DELETE | `/api/library/:id/nfo` | Remove the `.nfo` sidecar file |

### `GET /api/library` — query params (all optional)

| Param | Meaning |
|---|---|
| `q` | Full-text search (title/uploader/artist/description) |
| `collectionId` | Filter to one collection; `"none"` = uncategorized only |
| `collectionIds` | Comma-separated ids, IN-match; takes precedence over `collectionId` |
| `year` | Filter by release year |
| `tags` | Comma-separated tag names |
| `sortKey` | `downloadedAt` (default) \| `title` \| `filename` \| `year` \| `duration` \| `sequenceNumber` |
| `sortDir` | `desc` (default) \| `asc` |
| `page` | 1-based; pagination activates only when set |
| `pageSize` | Only read when `page` is set |

Response is always a wrapper, even with no pagination:

```json
{ "items": [ /* library items */ ], "total": 137 }
```

`total` is the full match count ignoring page/pageSize (for "Page X of Y" UI). Each item:

```json
{
  "id": 118, "downloadId": 42, "title": "Some Video", "filename": "Some Video.mp4",
  "path": "Music Videos/Some Video.mp4", "collectionId": 4, "collectionName": "Music Videos",
  "folder": "", "originalUrl": "https://youtube.com/watch?v=abc123",
  "uploader": "Some Channel", "duration": 214, "resolution": "1920x1080",
  "mediaType": "video", "thumbnail": "Music Videos/Some Video.jpg",
  "thumbnailSmallPath": "library/118/small/e1cdb9a8....webp",
  "thumbnailMediumPath": "library/118/medium/e1cdb9a8....webp",
  "thumbnailWidth": 1920, "thumbnailHeight": 1080,
  "description": "...", "artistId": 3, "artistName": "Some Artist", "year": 2023,
  "sequenceNumber": null, "seasonNumber": 2, "generateNfo": true, "nfoExists": true,
  "downloadedAt": "2026-07-19T10:02:00Z", "status": "completed", "blurred": false,
  "fileSizeBytes": 84213099, "tags": ["music", "live"],
  "playbackPositionSeconds": 812, "lastWatchedAt": "2026-07-20T21:15:00Z",
  "galleryCount": 3,
  "activeDownloadId": null
}
```

`blurred` is true if privacy is enabled (Settings → Privacy master switch) **and** the item's
collection (or an ancestor) is private, **or** its own artist (`artistId`) is private, **or** any of its tags is marked private; it is always `false`
when privacy is off. The rule is the same in every endpoint that returns a library item (list, get-one,
compare list, refresh-metadata, trim accept, thumbnail set/redownload/quick-grab/gallery apply/frame-match
accept, file import, ghost creation). `tags` is never `null` — `[]` if none. `mediaType` is `"video"`, `"audio"`, or
`null` (unset ghost items only — see Ghost items below). `status` is `"completed"` for a real
downloaded/imported item or `"ghost"` for a placeholder with no file.

`nfoExists` says whether the item's `.nfo` sidecar is on disk. **Single-item** responses (`GET /api/library/:id`
and every endpoint that returns the one item it just changed) always check the disk. **List** responses
(`GET /api/library`, the compare list) check only items whose `generateNfo` is `true`, on a small worker
pool (8 at a time), so a large library on a network share doesn't cost a file check per item; for an
item with `generateNfo: false` the list reports `nfoExists: false` **without having looked** (a leftover
`.nfo` reads `false` there and `true` from `GET /api/library/:id`). So in a list, `nfoExists` is only
reliable when `generateNfo` is true. `GET /api/library/:id/nfo` answers `404` when there is no file.

`thumbnailSmallPath`/`thumbnailMediumPath` are the WebP derivatives actually rendered in the UI
(grid thumbnail, card image) — `thumbnail` is the original, full-size sidecar image on disk, never
rendered directly. `thumbnailWidth`/`thumbnailHeight` are the **original** sidecar image's pixel
dimensions (not the derivative's), probed once server-side whenever the thumbnail is written and
persisted on the row — `null` until the item has a thumbnail and it's been probed (existing items
predating this column are backfilled via `POST /api/settings/backfill-images`; see Settings below).
These two fields are deliberately omitted from library backup exports — they're a disposable
derived value, regenerated the next time the thumbnail changes.

`playbackPositionSeconds`/`lastWatchedAt` back the Browse page's "Continue Watching" row — see
`POST /api/library/:id/progress` below. `activeDownloadId` is the id of the item's queued/running download (a ghost being downloaded — its `downloads.ghost_library_item_id` — or a redownload target), `null` when none; it is batch-loaded, one query per response. `galleryCount` is the number of saved images in this item's
thumbnail gallery — see Thumbnail gallery below.

### `GET /api/library/:id` — no params

One item, the same response shape as a row from `GET /api/library` (including `blurred`) — for a
caller that needs one item without fetching/filtering the whole list (e.g. checking an item's
privacy status before showing its title in a desktop notification). `404` unknown id.

### `GET /api/library/facets` — no params

```json
{ "years": [2019, 2021, 2022, 2024] }
```

Computed across the whole library, independent of the current search/page.

### `DELETE /api/library/:id?deleteFiles=true`

`deleteFiles` (default false) best-effort removes the media file, thumbnail and `.nfo` sidecar from
disk — a missing file is logged, not an error. Regardless of `deleteFiles`, once the row is deleted
the item's `ImagesRoot` artifacts are removed too: `library/<id>/` (thumbnail tiers + AI-enhancement
original), `thumbnail-gallery/<id>/` and `frame-match/<queueId>/` for each of its frame-match queue
rows. Files are only touched after the DB delete succeeds. A queued/running download that is filling the
item in (`activeDownloadId`) is cancelled first. `404` unknown, `204` on success.

### `POST /api/library/bulk-update` — partial merge per item (fields omitted are left untouched)

```json
{ "items": [ { "id": 7, "changes": { "title": "New Title", "artistId": 3, "year": 2023, "tags": ["music", "live"] } } ] }
```

Edits one or many items; a single edit is a one-element list. Per-item results (see
[Bulk endpoints](#bulk-endpoints)); `400` for an empty list, more than 1000 items, or a duplicate id.

Every `changes` field is optional and means what it did on the old PATCH: `title`, `filename`,
`uploader`, `description`, `duration`, `resolution`, `artistId` (`0` explicitly clears it — distinct from
omitting the field), `year`, `sequenceNumber`, `seasonNumber` (`0` clears these three too),
`generateNfo`, `originalUrl`, `tags` (whole-array **replace**, not merge, when present — creates missing
tag names). Per item:

- an item with an active download fails with status `409` "a download is already in progress for this
  item"; an unknown id fails with `404`.
- `filename` set → takes the item lock, renames the media file, its thumbnail and its `.nfo` sidecar (when
  one exists on disk, even with `generateNfo` off) together on disk (sanitized; status `400` if that yields
  an empty name, `409` if any of the three target names is already taken, in which case nothing is
  renamed). A busy item (a remux or other
  file operation holds it) fails with `409` and the usual "This item is being updated. Try again in a
  moment." without aborting the other items.
- Changing `title`/`artistId`/`year`/`sequenceNumber`/`seasonNumber` submits one **background**
  `ffmpeg -c copy` remux per item to the coalescing scheduler that re-embeds those tags into the file's
  own container metadata — failures are logged only.
- If `generateNfo` is on (or just turned on) and any NFO-relevant field changed, the `.nfo` sidecar is
  rewritten in sync, best-effort.
- An item is validated before anything is written: a rejected edit (`400` no media file to rename / invalid
  filename / unknown `artistId`, `409` a target file name taken) leaves it **completely unchanged** — title,
  metadata and tags included. The rename runs first and its new path is recorded at once (undone on a
  failure), then the other fields are written.
- Each item's database writes after that are still separate statements (not one batch transaction).

### `POST /api/library/bulk-tags`

```json
{ "itemIds": [1, 2, 3], "tags": ["music", "favorites"] }
```

**Overwrites** (not merges) the tag set on every listed item, creating missing tag names, and
keeps each opted-in item's `.nfo` sidecar in sync. Items with an active download are left out.
`200 {"updated": 2, "skipped": 1, "skippedDownloading": 1}` (here `skipped` only counts the
active-download items). *Previously `204 No Content`.*

### `POST /api/library/bulk-delete`

```json
{ "itemIds": [1, 2, 3], "deleteFiles": true }
```

One `deleteFiles` flag for the whole batch (same on-disk cleanup as the single-item version; files
are removed only after the transaction commits). An already-gone id is silently skipped, and the
selected items' active downloads are cancelled first. Response:
`200 {"deleted": 3}`.

### `POST /api/library/:id/move`

```json
{ "collectionId": 5, "folder": "Subfolder" }
```

Relocates the media file, its thumbnail and its `.nfo` sidecar (when one exists on disk) on disk to the
resolved target, all or none. `400` invalid collection/folder, `409` if the media file, thumbnail or
sidecar name is already taken in the target folder (nothing moved), `500` on FS error (anything already
moved is moved back), `204` on success.

### `POST /api/library/:id/refresh-metadata` — no body

Re-fetches yt-dlp metadata for `originalUrl` and **overwrites** `title`/`uploader`/`duration`/
`resolution`/`description` (never touches the file/thumbnail on disk; `artist`/`year`/
`sequenceNumber`/`seasonNumber` are manual-only and untouched). `400` no source URL, `502` fetch
failure. Also re-syncs the `.nfo` sidecar if enabled. Response `200` with the full updated item.

### `GET /api/library/:id/metadata-preview` — no body

Same yt-dlp re-fetch as refresh-metadata, but **read-only — never writes to the DB**. Powers the
"Compare Metadata" dialog. `400` no source URL, `502` fetch failure.

```json
{
  "title": "Some Video (Remastered)", "uploader": "Some Channel", "duration": 215,
  "description": "...", "thumbnail": "https://...jpg", "resolution": "1920x1080"
}
```

### `GET /api/library/:id/probe-metadata` — no body, read-only

Runs `ffprobe` directly against the **file on disk** (not a network fetch) and returns what it
finds — resolution/duration/frame rate, `null` where not applicable (e.g. no duration for a still
image). Answers "does what's saved in the DB match the actual file?" (catches drift from an
out-of-band file replacement, or a Trim side effect), as opposed to `metadata-preview` above, which
answers "did the upstream source change?" `400` item has no media file (ghost item), `404` unknown
item.

```json
{ "resolution": "1920x1080", "durationSeconds": 214, "frameRate": 29.97 }
```

### Items with an active download are locked

While an item has a queued/running download (`activeDownloadId` is set) every single-item route that
changes the item or its files answers **`409 {"error": "a download is already in progress for this
item"}`**: `DELETE .../file`, `POST .../move`, `.../refresh-metadata`,
`.../trim/accept`, `POST/DELETE .../thumbnail`, `.../thumbnail/redownload`, `.../thumbnail/quick-grab`,
`POST .../thumbnail/gallery`, `.../thumbnail/gallery/:galleryId/apply`, `POST
.../thumbnail/gallery/bulk-favorite` and `.../bulk-delete` (the whole request), `.../thumbnail/match`, `POST/DELETE .../nfo`, `POST .../redownload`,
`.../redownload/from-url`, plus `POST /thumbnail-enhancement/items/:id/revert` and `DELETE
/thumbnail-enhancement/items/:id/original`. Reads, `POST .../progress` and `DELETE /library/:id` (which
cancels the download) are unaffected. The multi-item endpoints skip such items instead of failing (see
`skippedDownloading` on each); `bulk-delete` is unchanged and cancels their downloads.

### Items whose file is being rewritten are locked briefly

Editing title/artist/year/season/sequence starts a background ffmpeg remux that rewrites the media
file's tags; it can run for minutes on a large file. While it (or another file operation on the same
item) runs, a request that would write, move or delete that file answers **`409 {"error": "This item
is being updated. Try again in a moment."}`** and changes nothing: `POST .../move`,
`POST .../trim/accept`, `DELETE .../file`, an item of `POST /library/bulk-update` **whose `changes` contain `filename`** (that item alone fails; the others still run),
`DELETE /library/:id?deleteFiles=true`, and the bulk `POST /library/bulk-delete` (with
`deleteFiles: true`) and `POST /library/bulk-delete-file`. Those two bulk endpoints are all-or-nothing: one
busy item refuses the whole request. Requests never wait for the remux. Several edits of one item
while a remux runs are coalesced into one follow-up remux with the latest values. This is separate from
the active-download `409` above.

### `POST /api/library/:id/redownload` — no body

Re-queues a download from `originalUrl`, reusing the exact original type/quality/filename/
audioFormat if the originating download row still exists, else falling back to app defaults.
`400` no source URL. `409` the item already has a queued/running download. Response `201 {"id": <newDownloadId>}`.

### Redownload from a different URL

- **`GET /api/library/:id/redownload/preview-url?url=https://...`** — read-only, same shape as
  `metadata-preview` but against an arbitrary URL instead of the item's own `originalUrl`. `400`
  invalid URL, `422` fetch failure.
  ```json
  {
    "title": "Some Video (Alt Upload)", "uploader": "Another Channel", "duration": 220,
    "description": "...", "thumbnail": "https://...jpg", "resolution": "1920x1080",
    "duplicate": { "libraryItemId": 90, "title": "Other Item", "thumbnail": "...", "downloadedAt": "2026-07-19T10:00:00Z", "blurred": false }
  }
  ```
  `duplicate` is set only when the URL matches a *different* library item, else `null`; it has the
  same `blurred` flag as in `POST /api/downloads/preview`.
- **`POST /api/library/:id/redownload/from-url`** —
  ```json
  { "url": "https://youtube.com/watch?v=xyz789", "overwriteFields": ["resolution", "duration"] }
  ```
  `url` required. `overwriteFields` is a subset of `title`/`uploader`/`description`/`thumbnail`/
  `resolution`/`duration` — `400` on anything outside that set. `originalUrl` (and its video ID)
  always switch to the new URL regardless of `overwriteFields`; only the *content* of the listed
  fields is overwritten. Reuses the original download row's type/quality/audioFormat if it still
  exists. Response `201 {"id": <newDownloadId>}`.

### `POST /api/library/:id/progress`

```json
{ "positionSeconds": 842 }
```

`positionSeconds` required, `>= 0`. Records live playback position for the Browse page's "Continue
Watching" row (see [Browse](FEATURES.md#browse)) — called repeatedly (throttled client-side) during
video playback, hence a narrow single-field endpoint rather than the general `PATCH /:id`.
Video-only in practice; music playback never calls this. `404` unknown item, `204` on success.

### Ghost items

A ghost item is a library row with metadata but **no downloaded file** — `filename`/`path` are
`""` and `status="ghost"`. Used as a placeholder you fill in later (Redownload relabels itself
"Download now" for these), and it's also the state a real item falls back into when its file is
deleted (`DELETE /:id/file`) or found missing on disk (`scan-missing`).

- **`POST /api/library/ghost`** —
  ```json
  {
    "title": "Some Video", "mediaType": "video", "originalUrl": "https://youtube.com/watch?v=abc123",
    "collectionId": 4, "artistId": 3, "year": 2023, "seasonNumber": 2, "sequenceNumber": null,
    "generateNfo": false, "tags": ["music", "live"], "fetchThumbnail": true
  }
  ```
  `title` and `mediaType` (`video`|`audio`) required; everything else optional. `mediaType` is
  picked manually since there's no file/download row to infer it from — it only selects which
  placeholder icon shows until the item is downloaded. If `fetchThumbnail` and `originalUrl` are
  both set, a best-effort thumbnail fetch runs before responding (failure is logged, not fatal).
  Response `201` with the full library item (`galleryCount` always `0` on a fresh item).
- **`DELETE /api/library/:id/file?deleteThumbnail=true`** — removes just the media file (best-effort
  on disk) and flips the item to `status="ghost"`; all other metadata (tags, collection, artist,
  etc.) is untouched. The `.nfo` sidecar is always removed with the media file. `deleteThumbnail`
  (default false) also removes the thumbnail, its `ImagesRoot` WebP tiers (clearing the stored
  thumbnail dimensions too) and the AI-enhancement original. For an image item the `thumbnail` field
  (the image file itself) is cleared even when `deleteThumbnail` is false (the tiers stay). Files are removed only after the DB
  update succeeds. Distinct from
  the already-documented `DELETE /api/library/:id?deleteFiles=true`: that one deletes the DB row
  entirely and is permanent — this keeps the row so it can be redownloaded later. `400` item is
  already a ghost, `404` unknown id, `204` on success.
- **`POST /api/library/scan-missing`** — optional body `{"confirm": true}` (a missing or empty body
  works exactly as before; malformed JSON is `400`). Checks every non-ghost item's on-record file
  against disk; anything gone is converted to a ghost the same way. On-demand only (Settings →
  Library → "Scan for Missing Files"), never scheduled. Only a definite "does not exist" counts as
  missing: any other stat error (permissions, I/O error, stale network handle) leaves the item
  untouched and is counted in `unreadable`.
  ```json
  { "scanned": 137, "missing": [ { "id": 118, "title": "Some Video" } ], "unreadable": 0 }
  ```
  Guards (nothing is changed when one trips; the full list is decided before any item is cleared):
  - `409 {"error": "The media folder … Is it mounted? Nothing was changed."}` — the media root does
    not exist, is not a readable folder, or is completely empty while the library has non-ghost
    items. `confirm` does not override this.
  - `409 {"error": "This would convert M of N items to ghosts. …", "requiresConfirm": true,
    "scanned": N, "wouldClear": M}` — the scan would clear 10 or more items **and** at least half of
    those scanned. Resend with `{"confirm": true}` to proceed (still `does not exist` only).
- **`POST /api/library/bulk-redownload`** — `{ "itemIds": [1, 2, 3] }`. Redownloads each item from
  its own `originalUrl` (same resolution/duration-only overwrite as single-item Redownload). Items
  with no URL, with an active download, or whose enqueue fails, are silently skipped.
  `200 {"queued": 2, "skipped": 1, "skippedDownloading": 0}` (`skippedDownloading` is the part of
  `skipped` left out because of an active download).
- **`POST /api/library/bulk-fetch-thumbnails`** — `{ "itemIds": [1, 2, 3] }`. Re-fetches each item's
  thumbnail from its `originalUrl` — works identically for ghost or real items, since it only
  writes the `ImagesRoot`-relative WebP derivatives, never the `MediaRoot`-relative sidecar. Items
  with no source URL, a failed fetch, or an active download, are skipped.
  `200 {"fetched": 2, "skipped": 1, "skippedDownloading": 0}`.
- **`POST /api/library/bulk-delete-file`** — `{ "itemIds": [1, 2, 3], "deleteThumbnail": true }`. One
  `deleteThumbnail` flag for the whole batch (same semantics as the single-item version above). An
  id already gone, or already a ghost, is silently skipped; an item with an active download is left
  untouched and counted. `200 {"deleted": 2, "skipped": 1, "skippedDownloading": 1}` (here `skipped`
  only counts the active-download items).

### Trim

Cuts a precise portion off the start and/or end of a video/audio file, previewed before committing.

- **`POST /api/library/:id/trim/preview`** —
  ```json
  { "trimStartSeconds": 5.2, "trimEndSeconds": 118.75 }
  ```
  At least one of the two required; either may be `null` ("don't trim that end"). Generates a
  trimmed copy into a scratch dir under `mediaRoot` — **the original file is untouched**. `400`
  both fields omitted or item has no media file, `404` unknown item, `422` ffmpeg failure. Response
  `200`:
  ```json
  { "previewPath": ".trim-tmp/.trim-preview-abc123.mp4", "durationSeconds": 113, "fileSizeBytes": 48213099 }
  ```
  `previewPath` is `MediaRoot`-relative, playable via the existing `/media-files/*path` route.
- **`POST /api/library/:id/trim/accept`** — `{ "previewPath": ".trim-tmp/.trim-preview-abc123.mp4" }`.
  The server re-validates that the path resolves under `mediaRoot`, sits directly inside the shared
  trim scratch dir, and matches the `.trim-preview-` naming convention (`400` otherwise — defense
  against accepting an unrelated file). Overwrites the item's real media file with the preview,
  re-probes duration/size, updates the DB. Response `200` with the full updated library item.
- **`POST /api/library/:id/trim/discard`** — same body/validation as accept, just deletes the
  preview file without touching the original. `204`.
- **`GET /api/library/:id/trim/frames?start=5.0&end=8.0`** — read-only, nothing persisted. Decodes
  every frame in `[start, end)` for frame-accurate seeking the browser's own scrubber can't
  guarantee. `400` invalid range, `422` extraction failure.
  ```json
  { "frames": [ { "timestampSeconds": 5.04, "imageBase64": "/9j/4AAQ..." } ] }
  ```

### Thumbnails

- **`POST /api/library/:id/thumbnail/redownload`** — no body. Re-fetches the thumbnail from
  `originalUrl`, overwriting the current one. Ghost items (no file) are accepted: only the resized
  `thumbnailSmallPath`/`thumbnailMediumPath` tiers are stored (plain `thumbnail` stays null). Responds
  with the updated item. `400` no source URL — or the item is an image (`mediaType=image`: its
  thumbnail is the image file itself), `502` fetch failure, `409` the item is being updated (see
  "Thumbnail writes" below). yt-dlp runs in a scratch directory and the result replaces the thumbnail
  only if everything succeeds.
- **`POST /api/library/:id/thumbnail/quick-grab`** — no body. Extracts one video frame at a random
  timestamp within the configured pick range (see `thumbnailFrameRangeLow`/`High` below; default
  5%-100% of duration, skipping the likely-blank intro) and sets it immediately. `502` if extraction
  fails. `400` for an image item (its thumbnail is the image file itself). `409` the item is being updated.
- **`GET /api/library/:id/thumbnail/timestamps`** — read-only; extracts nothing. Picks the
  timestamps for a "choose from video" batch: `count` frames spread across the pick range, one
  random point per equal bucket. Optional query params `count` (1–50), `low` and `high` (percent of
  duration, decimals allowed, `0 <= low < high <= 100`) override the `thumbnailFrameCount` /
  `thumbnailFrameRangeLow` / `thumbnailFrameRangeHigh` settings for this call only; `exclude` is a
  comma-separated list of timestamps to steer away from. `400` on an out-of-range value. The
  frontend then fetches the frames one at a time via `/candidates?timestamps=` to drive its
  progress bar.
  ```json
  { "timestamps": [12.4, 48.9, 77.1, 103.6] }
  ```
- **`GET /api/library/:id/thumbnail/candidates`** — no body, read-only. Extracts N frames (N = the
  `thumbnailFrameCount` setting: 2/4/6/8/12/24), spread across the same configured pick range, as
  base64 JPEGs. With `timestamps=` (comma-separated, at most 50) it extracts exactly those instead
  of picking new ones. A per-candidate failure is skipped, not fatal; `502` only if zero candidates
  could be extracted.
  ```json
  { "candidates": [ { "timestampSeconds": 34.2, "imageBase64": "/9j/4AAQ..." } ] }
  ```
- **`POST /api/library/:id/thumbnail`** — `{ "imageBase64": "/9j/4AAQ..." }`. Writes the given
  bytes as the thumbnail — finalize step for "choose from video." `400` invalid base64, or
  `{"error": "the data is not a decodable image"}` when the bytes are not a JPEG/PNG (nothing is changed);
  `409` the item is being updated. All thumbnail endpoints respond `200` with the full updated library item. For an **image item**
  (`mediaType=image`) the bytes only regenerate the small/medium tiers (`thumbnailSmallPath`/
  `thumbnailMediumPath`, stale tiers and AI-enhancement backup removed); the media file and `thumbnail`
  are never written.
- **`DELETE /api/library/:id/thumbnail`** — removes the thumbnail (all tiers) and the item's
  AI-enhancement original (the enhanced image *is* the thumbnail, so the backup has nothing left to
  compare against or revert onto). `400` for an image item (`"an image item's thumbnail is the image
  file itself"` — the thumbnail would be the image), `404` unknown item,
  `204` on success.

**Thumbnail writes.** Set thumbnail, Quick Grab, Redownload, gallery apply and frame-match accept replace
the sidecar through one safe path (`internal/thumbwrite`, see `docs/architecture.md`): a failure at any
step answers an error and leaves the sidecar, the small/medium versions, the row and the AI-enhancement
backup as they were. They hold the item lock only for the swap, so a request that finds the item busy
(a rename/move/remux in progress) answers **`409 {"error": "This item is being updated. Try again in a
moment."}`** and changes nothing. Failures other than those listed per endpoint answer `500` with the error message.

### Thumbnail gallery

A per-item collection of saved candidate thumbnail images — separate from the one *active*
thumbnail — so a few good options can be stashed and switched between later without
re-extracting/re-fetching. Cascade-deleted with the library item.

- **`POST /api/library/:id/thumbnail/gallery`** — body optional:
  ```json
  { "imageBase64": "/9j/4AAQ...", "timestampSeconds": 83.417 }
  ```
  Empty/omitted body saves a copy of the item's *current* thumbnail as-is; a non-empty
  `imageBase64` saves those exact bytes instead (e.g. a specific frame from "Choose from Video," or
  a Frame Matching result). Optional `timestampSeconds` records the video position the frame came
  from (millisecond-precise float); omit/`null` when unknown. `400` item has neither a current
  thumbnail nor a supplied image. Response `201`:
  ```json
  { "id": 12, "imagePath": "thumbnail-gallery/118/6c1f...-4a2e.jpg", "width": 1920, "height": 1080, "timestampSeconds": 83.417, "isFavorite": false, "createdAt": "2026-07-19T10:00:00Z" }
  ```
- **`GET /api/library/:id/thumbnail/gallery`** — no params.
  ```json
  { "images": [ { "id": 12, "imagePath": "thumbnail-gallery/118/6c1f...-4a2e.jpg", "width": 1920, "height": 1080, "timestampSeconds": 83.417, "isFavorite": false, "createdAt": "..." } ] }
  ```
  Newest first. `timestampSeconds` is `null` for rows saved before the field existed and for saves
  that carry no source time (a copy of the current thumbnail, an enhancement compare image).
  Sorting/filtering by frame time or favorite is done client-side.
  `imagePath` is `ImagesRoot`-relative, served under `/local-images/*` — distinct from `thumbnail`,
  which is `MediaRoot`-relative.
- **`POST /api/library/:id/thumbnail/gallery/:galleryId/apply`** — no body. Makes a saved gallery
  image the item's active thumbnail (same finish as `POST .../thumbnail`: regenerates derivatives,
  clears any stale AI-enhancement backup; for an image item only the tiers change, as for
  `POST .../thumbnail`). `400` item has no media file, or `galleryId` belongs to a
  different item; `404` unknown gallery id/item; `409` the item is being updated. `200` with the full updated library item.
- **`POST /api/library/:id/thumbnail/gallery/bulk-favorite`** — body
  `{ "galleryIds": [12, 13], "isFavorite": true }`. All-or-nothing: a gallery id that belongs to a
  different item **or does not exist** fails the whole request with `400 {"error": "...",
  "invalidIds": [..]}` and changes nothing. `200 {"updated": <n>}`.
- **`POST /api/library/:id/thumbnail/gallery/bulk-delete`** — body `{ "galleryIds": [12, 13] }`.
  Removes the saved images (rows in one transaction, files after the commit, best effort); doesn't touch
  the active thumbnail. A gallery id that belongs to a different item fails the whole request with
  `400 {"error": "...", "invalidIds": [..]}`; ids that do not exist are ignored. `200 {"deleted": <n>}`.
  Both answer `409` (the whole request) while the item has an active download.

### Frame matching

Scans a video for the frame that most closely matches a reference image (either the item's
source-URL thumbnail or its current thumbnail file) — useful when a saved thumbnail is a
degraded/cropped/re-encoded copy and you want to relocate it back to the actual clean frame it came
from. Uses perceptual-hash comparison (a coarse sweep, then a fine windowed pass on the best
candidates), **not** duplicate-video detection. Two independent flows: a single-item ad-hoc job
(poll-based, in-memory — lost on restart), and a durable bulk queue reviewed on the dedicated
"Frame Matching" page.

- **`POST /api/library/:id/thumbnail/match`** — (`400` for an image item) `{ "mode": "url" }` (`"url"` re-fetches the source
  URL's thumbnail fresh to compare against; `"current"` compares against whatever thumbnail file
  the item has right now, including an enhanced one). `400` no media file, `404` unknown item,
  `409` item already has a pending/awaiting-review row in the bulk queue, `502` reference-image
  resolution failed. Response `200 {"jobId": "b3f1..."}` — matching runs in the background.
- **`GET /api/thumbnail-match/:jobId`** —
  ```json
  {
    "state": "done", "timestampSeconds": 842.5, "score": 91.4,
    "imageBase64": "/9j/4AAQ...", "referenceImageBase64": "/9j/4AAQ..."
  }
  ```
  `state` is `"running"`, `"done"`, or `"error"` (then `{"state":"error","error":"..."}`). `score`
  is 0–100, higher = closer match — never hidden even when low, since a correct match can still
  score in the 70s–80s. `404` unknown job id (never existed, or the process restarted).
- **`POST /api/library/thumbnail/match/bulk`** — `{ "itemIds": [101, 102, 103], "mode": "url" }`.
  Enqueues each eligible item onto the durable queue, worked one at a time by a background worker.
  An item is skipped (not an error) if it's a ghost, an image, or ineligible for the mode (no `originalUrl`
  for `"url"`, no current thumbnail for `"current"`) or has an active download; already-queued is
  counted separately. Response `202 {"queued": 2, "skipped": 1, "skippedDownloading": 0, "alreadyQueued": 0}`
  (`skippedDownloading` is the part of `skipped` left out because of an active download).
- **`GET /api/frame-match/queue`** — no params. Every row currently queued/running/done/error,
  oldest first:
  ```json
  {
    "id": 7, "libraryItemId": 118, "itemTitle": "Some Video", "mode": "url", "state": "done",
    "timestampSeconds": 842.5, "score": 91.4,
    "foundFramePath": "frame-match/7/found.jpg", "referenceImagePath": "frame-match/7/reference.jpg",
    "error": null
  }
  ```
  `foundFramePath`/`referenceImagePath` (`ImagesRoot`-relative) populate once `state="done"` — a
  snapshot from match-completion time, so the review screen always matches the recorded score even
  if the source or live thumbnail changes before you review it.
  A row that was `running` when the server stopped (or crashed) comes back as `state="error"` with
  `"error": "Interrupted by a restart. Queue it again."` — it is never re-queued automatically (a
  file that crashes the process would crash-loop the server). The row still counts as "already in the
  queue", so discard it (`DELETE /api/frame-match/queue/:id`) and queue the item again.
- **`POST /api/frame-match/queue/:id/accept`** — no body. Writes the row's found frame as the
  item's active thumbnail (same commit path as `SetLibraryThumbnail`/gallery-apply), then deletes
  the queue row and its snapshot images — a working queue, not a history. `409` row isn't
  `state="done"` or the item is being updated (the queue row is kept), `400` item has no media file (an image item takes the tiers-only route), `500` the write failed (nothing changed, queue row kept), `200` with the full updated library item.
- **`DELETE /api/frame-match/queue/:id`** — no body. Removes the row and its snapshot files without
  touching the item's thumbnail; also cancels a still-running row. `404` unknown id, `204`.

### NFO sidecars

- **`POST /api/library/:id/nfo`** — no body. `400 {"error":"Generate NFO is not enabled for this item"}`
  if the `generateNfo` toggle is off, else writes/overwrites the sidecar. `204`.
- **`GET /api/library/:id/nfo`** — `200 {"content": "<movie>...</movie>"}`. `404` if none generated
  yet.
- All three NFO endpoints answer `400 {"error":"item has no media file"}` for an item without a
  file (a ghost).
- **`DELETE /api/library/:id/nfo`** — removes the sidecar file only, does **not** touch the
  `generateNfo` toggle (so it reappears on the next relevant edit if still on). Idempotent, `204`.

## Collections

| Method | Path | Description |
|---|---|---|
| GET | `/api/collections` | List all collections |
| POST | `/api/collections` | Create a collection |
| PATCH | `/api/collections/:id` | Update a collection |
| DELETE | `/api/collections/:id` | Delete a collection |
| POST | `/api/collections/bulk-delete` | Delete many at once |
| GET | `/api/collections/:id/cover-candidates` | List image files already in this collection's folder |
| POST | `/api/collections/:id/cover` | Set the collection's cover image |
| DELETE | `/api/collections/:id/cover` | Remove the collection's cover image |

### `GET /api/collections`

```json
{
  "id": 7, "name": "Anime", "parentId": 2, "rootPath": "Anime", "path": "Shows/Anime",
  "defaultQuality": "1080p", "defaultDownloadType": "video", "filenameTemplate": "{title}",
  "isPrivate": false, "seasonNumber": 2, "year": null, "sequenceMin": null, "sequenceMax": 12,
  "artistId": null, "browseAsShow": false, "itemCount": 12,
  "effectiveIsPrivate": false, "totalItemCount": 40, "ghostItemCount": 1, "totalGhostItemCount": 3,
  "sequenceGaps": { "min": 1, "max": 12, "count": 3, "missing": [4, 5, 9] },
  "coverImagePath": null, "coverImageSmallPath": null, "coverImageMediumPath": null,
  "latestItemThumbnailPath": "Anime/Season 1/Episode 3.jpg",
  "jellyfinLibraryId": "3c8f6b1a-...", "createdAt": "...", "updatedAt": "..."
}
```

`isPrivate`/`itemCount` are this collection's own flag and direct item count; `effectiveIsPrivate`
(this OR any ancestor private) and `totalItemCount` (own + all descendants) are the
inheritance-aware versions used by things like the Library toolbar's reveal-all control.
`coverImage*Path` are set only once a cover has been explicitly assigned (see below); until then,
folder/Browse tiles fall back to `latestItemThumbnailPath` — the most-recently-downloaded item's
thumbnail anywhere in the collection's subtree.

`ghostItemCount`/`totalGhostItemCount` are the placeholder (no-file) subsets of `itemCount`/
`totalItemCount`, with the same own-versus-rolled-up scoping. `sequenceGaps` summarizes the holes in
this collection's own sequence numbers and is `null` when there is nothing to report (no range, or
nothing missing): `min`/`max` are the expected range — the items' lowest and highest sequence number,
each replaced by the collection's `sequenceMin`/`sequenceMax` when that is set — `count` is the true number of
missing numbers, and `missing` lists them (capped at the first 50).

### Cover image

- **`GET /api/collections/:id/cover-candidates`** — read-only. Recursively scans the collection's
  own resolved on-disk folder for image files already present among its downloaded content —
  nothing is copied yet. `404` unknown collection.
  ```json
  { "candidates": [ { "relPath": "Anime/Season 1/poster.jpg" } ] }
  ```
  `relPath` is `MediaRoot`-relative, same convention as a library item's `thumbnail`.
- **`POST /api/collections/:id/cover`** — exactly one of two sources:
  ```json
  { "sourceRelPath": "Anime/Season 1/poster.jpg", "imageBase64": null, "filename": null }
  ```
  or
  ```json
  { "sourceRelPath": null, "imageBase64": "/9j/4AAQ...", "filename": "cover.jpg" }
  ```
  `400` neither source set, `404` unknown collection. Generates three WebP derivatives (small
  320px / medium 800px / a capped 1920px "original" — never the untouched source bytes), deletes
  the old cover's files (best-effort), persists the three new relative paths. Response `200`:
  ```json
  {
    "coverImagePath": "collections/7/original-<uuid>.webp",
    "coverImageSmallPath": "collections/7/small-<uuid>.webp",
    "coverImageMediumPath": "collections/7/medium-<uuid>.webp"
  }
  ```
- **`DELETE /api/collections/:id/cover`** — deletes all three tier files (best-effort) and clears
  all three columns to `null`, reverting the collection to its automatic `latestItemThumbnailPath`
  fallback. `404` unknown collection, `204` on success.

### `POST /api/collections`

```json
{
  "name": "Anime", "parentId": 2, "rootPath": "Anime",
  "defaultQuality": "1080p", "defaultDownloadType": "video", "filenameTemplate": "{title}",
  "isPrivate": false, "jellyfinLibraryId": null, "seasonNumber": null, "year": null,
  "sequenceMin": null, "sequenceMax": null, "artistId": null, "browseAsShow": false
}
```

`name` and `rootPath` are required; `defaultQuality`/`defaultDownloadType` default to
`"best"`/`"video"` if empty. `rootPath` is validated to resolve under the media root (rejects
traversal). `400` unknown parent or invalid root path, `409` duplicate name (parent-scoped
uniqueness). Response `201 {"id": 7}`.

- `seasonNumber` — new downloads placed directly into this collection default their own Season #
  to this value (not inherited by sub-collections).
- `artistId` — new downloads placed into this collection, or any sub-collection that doesn't set
  its own `artistId`, default their own Artist to this value (walks up the ancestor chain).
- `year` — new downloads placed directly into this collection default their own Year to this value.
- `sequenceMin`/`sequenceMax` — the expected range of items (an unset minimum counts as 1 in the UI).
  They widen the range used for `sequenceGaps`, turn the Sequence # fields into a picker over the
  range, and let the Edit Sequence dialog show slots that aren't filled yet.
- `filenameTemplate` — the default Filename Template for new downloads into this collection (same
  tokens as `POST /api/downloads`); an empty value is stored as `"{title}"`. Applied **server-side**
  when a download request names this collection and gives neither a `filename` nor its own
  `filenameTemplate`.
- `browseAsShow` — the Browse page groups everything in this collection and its sub-collections
  behind one cover tile instead of listing the items separately.

### `PATCH /api/collections/:id`

Same shape as create, minus `parentId` (fixed at creation time). `404` unknown id, `409` duplicate
name, `204` on success.

### `DELETE /api/collections/:id`

`404` unknown, `409 {"error":"collection has sub-collections — move or delete them first"}` if it
has children, `204` on success. Never deletes the files inside it — items just lose their
collection association — but removes the collection's own cover images (`ImagesRoot/collections/<id>/`).
`bulk-delete` does the same for each deleted collection, after commit.

### `POST /api/collections/bulk-delete`

```json
{ "ids": [5, 6, 7] }
```

Deletes deepest-first (so a selected parent+child pair in the same batch succeeds regardless of
order). A collection left with a child that *wasn't* in the batch is skipped, not failed:

```json
{ "deleted": 2, "skipped": [5] }
```

## Tags

| Method | Path | Description |
|---|---|---|
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create a tag |
| PATCH | `/api/tags/:id` | Rename/update a tag |
| DELETE | `/api/tags/:id` | Delete a tag |
| POST | `/api/tags/bulk-delete` | Delete many at once |

`Tag`: `{id, name, isPrivate, createdAt, usageCount}`.

- **POST/PATCH** body: `{ "name": "...", "isPrivate": false }`. `name` required. `isPrivate` marks
  every item carrying this tag as blurred, same effect as a private collection. `409` if the name
  is already in use.
- **DELETE** — `204`, `404` unknown. `bulk-delete` — `{ "ids": [...] }` → `200 {"deleted": n}`;
  never fails for "in use" since the join table cascades on delete.

## Compare list

A scratch list of library items (video/audio files) queued up to **play back simultaneously in a
synced grid** — not a metadata/thumbnail comparison tool (that's Compare Metadata, under Library
above). Backed by a single unordered set, one user, no per-item metadata beyond insertion order.

| Method | Path | Description |
|---|---|---|
| GET | `/api/compare-list` | List every item currently on the compare list |
| POST | `/api/compare-list` | Add one or more items |
| DELETE | `/api/compare-list/:id` | Remove one item |
| DELETE | `/api/compare-list` | Clear the whole list |

### `GET /api/compare-list` — no params

A **bare array** (not the `{items, total}` wrapper `GET /api/library` uses), oldest-added-first, of
full library item objects — same shape and privacy-blur resolution as `GET /api/library`'s items.

### `POST /api/compare-list`

```json
{ "itemIds": [118, 119, 120] }
```

`itemIds` required, at least one. Re-adding an id already on the list is a silent no-op; an
unknown id is silently skipped rather than failing the whole batch. `204`.

### `DELETE /api/compare-list/:id` — no body

`:id` is the library item's own id. `404` not on the list, `204` on success.

### `DELETE /api/compare-list` — no body

Empties the list unconditionally. `204`.

Note: the frontend caps playback selection at 6 items and filters out ghost items (no file to
play) — the API itself enforces neither limit, so the list can hold more than 6 items even though
only 6 can be selected for simultaneous playback.

## Artists

Identical pattern to Tags, minus `isPrivate`, plus an optional image gallery.

| Method | Path | Description |
|---|---|---|
| GET | `/api/artists` | List all artists |
| POST | `/api/artists` | Create an artist |
| PATCH | `/api/artists/:id` | Update an artist (name, birthday, private flag) |
| DELETE | `/api/artists/:id` | Delete an artist (and its gallery images on disk) |
| POST | `/api/artists/bulk-delete` | Delete many at once (gallery images removed after commit) |
| GET | `/api/artists/:id/image-candidates` | Suggest images from this artist's own library items |
| GET | `/api/artists/:id/images` | List the artist's image gallery |
| POST | `/api/artists/:id/images` | Add an image to the gallery |
| DELETE | `/api/artists/:id/images/:imageId` | Remove a gallery image |
| POST | `/api/artists/:id/images/:imageId/select` | Set a gallery image as the display picture |
| DELETE | `/api/artists/:id/selected-image` | Clear the display picture (gallery image itself untouched) |

`Artist`: `{id, name, birthday, selectedImagePath, isPrivate, createdAt, usageCount}`. Create body:
`{ "name": "...", "birthday"?: "YYYY-MM-DD" | null, "isPrivate"?: bool }` (`isPrivate` defaults to `false`).
Update (`PATCH`) body: the same fields, but an **omitted `isPrivate` leaves the stored flag unchanged**, so
older clients that don't send it can't reset it. `isPrivate` is the raw flag (like collections); the UI only
acts on it while `privacyEnabled` is on. `409` on name conflict. Deleting an artist referenced elsewhere doesn't fail — the foreign key is
`ON DELETE SET NULL`. `birthday` is a nullable date-only string (`"1990-01-01"`); `selectedImagePath`
is a nullable relative path pointing at one of the artist's own gallery images (see below).

### Image gallery

- **`GET /api/artists/:id/image-candidates`** — read-only. Distinct thumbnail paths of every
  library item currently tagged with this artist — nothing copied yet.
  ```json
  { "candidates": [ { "relPath": "Music Videos/Some Video.jpg" } ] }
  ```
- **`GET /api/artists/:id/images`** —
  ```json
  [ { "id": 5, "relativePath": "artists/3/image-<uuid>.webp", "createdAt": "2026-07-19T10:00:00Z" } ]
  ```
- **`POST /api/artists/:id/images`** — same dual-source body as collection covers:
  ```json
  { "sourceRelPath": "Music Videos/Some Video.jpg", "imageBase64": null, "filename": null }
  ```
  `404` unknown artist, `400` neither source set. Generates one WebP derivative (single tier, max
  width 400px — unlike collection covers' three-tier split, since artist images are only ever shown
  small). Response `201 {"id": 5, "relativePath": "artists/3/image-<uuid>.webp", "createdAt": "..."}`.
- **`DELETE /api/artists/:id/images/:imageId`** — `404` unknown artist or image, `400` "image does not
  belong to this artist" (an image of another artist is never deleted, and that artist's selection is
  untouched — same check as `select`). Deletes the row and, in the same transaction, clears the artist's
  `selectedImagePath` if it was this image (never left dangling); the file is removed after the commit
  (best-effort). `204`.
- **`POST /api/artists/:id/images/:imageId/select`** — no body. `404` unknown image, `400` the
  image belongs to a different artist. Sets `selectedImagePath` to that image's path. `204`.
- **`DELETE /api/artists/:id/selected-image`** — no body. Clears the selection pointer only — the
  gallery image itself stays, still selectable again later. `404` unknown artist, `204`.

## Maintenance

### `GET /api/maintenance/stray-files`

Report only — never deletes. Detection rules: see `internal/strayfiles` and *Stray files* in
`FEATURES.md`.

```json
{
  "entries": [
    { "root": "images", "path": "library/12", "sizeBytes": 48211, "modifiedAt": "2026-10-13T09:00:00Z", "reason": "owner deleted" },
    { "root": "media", "path": "Music/old.nfo", "sizeBytes": 812, "modifiedAt": "2026-09-01T10:00:00Z", "reason": "orphan .nfo sidecar" }
  ],
  "totals": { "count": 2, "bytes": 49023 }
}
```

`root` is `images` (ImagesRoot) or `media` (MediaRoot); `path` is root-relative with `/`. Reasons:
`unreferenced file`, `owner deleted` (a whole `images/<kind>/<id>/` directory), `orphan .nfo sidecar`,
`orphan thumbnail sidecar` (only alongside a flagged orphan `.nfo` of the same name), `abandoned trim preview`, `abandoned partial download`. Files modified
in the last 10 minutes are never reported, and temp files (`abandoned trim preview`, `abandoned partial
download`) are omitted entirely while any download is active.

### `POST /api/maintenance/stray-files/delete`

```json
{ "paths": [ { "root": "images", "path": "library/12" }, { "root": "media", "path": "Music/old.nfo" } ] }
```

The stray check is re-run server-side at delete time and each path is resolved with
`pathsafe.ResolveUnderRoot`; only entries that are still stray are removed. Response:
`200 {"deleted": 2, "skipped": 0}` (`skipped` = no longer stray, unsafe or failed). `400` on an empty
list.

## Settings

| Method | Path |
|---|---|
| GET | `/api/settings` |
| PATCH | `/api/settings` |

### `GET /api/settings` — every field always present

```json
{
  "downloadDirectory": "/media", "maxConcurrentDownloads": 2, "maxConcurrentTranscodes": 2,
  "downloadTimeoutMinutes": 0, "defaultQuality": "best", "defaultDownloadType": "video",
  "importIgnoredFolders": [], "historyAnonymizeUrls": false, "historyRetentionDays": 0,
  "downloadLogRetentionDays": 0, "libraryView": "grid",
  "libraryMode": "manage", "libraryPaginationEnabled": false,
  "libraryPageSize": 48, "dashboardHiddenWidgets": [],
  "thumbnailFrameCount": 4, "thumbnailFrameRangeLow": 5, "thumbnailFrameRangeHigh": 100,
  "imageConvertFormat": "jpg",
  "privacyEnabled": false, "privacyBlurStrength": "default", "browseIgnorePrivacy": false,
  "skipDownloadPreview": false,
  "jellyfinEnabled": false, "jellyfinUrl": "", "jellyfinApiKey": "", "jellyfinRefreshMode": "none",
  "libraryAutoplay": true,
  "ytdlpCookiesBrowser": "", "ytdlpCookiesProfile": "", "ytdlpCookiesFile": "", "ytdlpProxy": "",
  "ytdlpRateLimit": "", "ytdlpRetries": 0,
  "autoBackupIntervalHours": 0, "backupRetentionCount": 14,
  "resolutionTierMediumEnabled": true, "resolutionThresholdLow": 720, "resolutionThresholdHigh": 2160,
  "thumbnailResolutionTierMediumEnabled": true, "thumbnailResolutionThresholdLow": 480,
  "thumbnailResolutionThresholdHigh": 1080,
  "featureSubscriptionsEnabled": true, "featureFrameMatchingEnabled": true,
  "featureCompareListEnabled": true, "featureFileImportEnabled": true,
  "featureSystemEventsEnabled": true, "systemEventsRetentionCount": 0,
  "thumbnailEnhancementEnabled": false, "thumbnailEnhancementUrl": "",
  "thumbnailEnhancementUsername": "", "thumbnailEnhancementPassword": "",
  "thumbnailEnhancementUpscaler": "R-ESRGAN 4x+", "thumbnailEnhancementMinDim": 720,
  "thumbnailEnhancementFactor": 4, "thumbnailEnhancementTargetMode": "factor",
  "thumbnailEnhancementTargetDim": 1920, "thumbnailEnhancementScheduleEnabled": true,
  "thumbnailEnhancementRetentionDays": 0, "thumbnailEnhancementAutoApprove": false,
  "thumbnailEnhancementAutoOnDownload": false, "thumbnailEnhancementMaxPerSweep": 5
}
```

(The values above are the defaults of a fresh install.)

`feature*Enabled` are the Settings → Features toggles (all default `true`). While one is `false`, every
route of that feature answers `403 {"error": "<Feature> is turned off in Settings → Features",
"feature": "feature_<name>_enabled"}`: `featureSubscriptionsEnabled` → `/api/subscriptions*`;
`featureFrameMatchingEnabled` → `/api/library/:id/thumbnail/match`, `/api/library/thumbnail/match/bulk`,
`/api/thumbnail-match/:jobId`, `/api/frame-match/*`; `featureCompareListEnabled` → `/api/compare-list*`;
`featureFileImportEnabled` → `/api/import*`. The flag is read per request, so a change applies
immediately. Turning Subscriptions from off to on also triggers an immediate sweep of due subscriptions.

`featureSystemEventsEnabled` (default `true`) is the system log's switch, shown in Settings → History rather
than Features; while `false`, `/api/system-events*` answers `403 {"error": "The system log is turned off in
Settings → History", "feature": "feature_system_events_enabled"}`, nothing new is recorded and stored events are
kept. `systemEventsRetentionCount` (integer ≥ 0, default `0` = Unlimited; anything else is a `400` on `PATCH`)
keeps only the newest N events: a `PATCH` that includes it prunes right away, and the hourly sweep and startup
prune too. See [System log](#system-log).

`downloadDirectory` and `maxConcurrentDownloads` reflect live config/worker-pool state, not just
the last saved DB value. `jellyfinApiKey` is returned in plaintext, not masked. `imageConvertFormat`
(`"original"|"jpg"|"png"|"webp"`, default `"jpg"`; edited in Settings → Downloads → Images) is the format every
`downloadType=image` download gets re-encoded to — matches the existing convention that video/audio thumbnails always normalize to
JPEG. `thumbnailFrameRangeLow`/`thumbnailFrameRangeHigh` (percent 0-100, default 5/100) bound which
portion of a video's duration "Choose from Video"/Quick Grab pick candidate frames from — see the
Library thumbnail endpoints above.

Other fields, each configured on its own Settings tab (see `docs/FEATURES.md` → Settings):

- `maxConcurrentTranscodes` — how many trim previews (ffmpeg re-encodes) may be generated at once;
  like `maxConcurrentDownloads` it resizes the live limit immediately and survives a restart. The
  `MAX_CONCURRENT_FFMPEG_TRANSCODES` environment variable is only the fallback for a fresh database.
- `privacyEnabled` — master switch of the privacy workflow (blurring, lock icons, the Private
  checkboxes); a collection's or tag's own Private flag is never changed by it. `privacyBlurStrength`
  is `"weak"|"default"|"strong"`; `browseIgnorePrivacy` shows private items unblurred on the Browse
  page only.
- `ytdlpCookiesBrowser`/`ytdlpCookiesProfile`/`ytdlpCookiesFile`, `ytdlpProxy`, `ytdlpRateLimit` and
  `ytdlpRetries` (`0` = yt-dlp's defaults, otherwise passed as both `--retries` and `--fragment-retries`) are passed to every yt-dlp call (see the yt-dlp and Proxy
  sections). A cookies *file* takes precedence over a cookies *browser*. The cookies file on disk is kept in sync with
  `ytdlpCookiesFile` on a PATCH that includes it (a failed write is a `500`, the setting stays saved), on
  settings import and full restore (a failed write is only logged), and at server start.
- `resolutionTierMediumEnabled`, `resolutionThresholdLow`/`resolutionThresholdHigh` (one of
  480, 720, 1080, 1440, 2160, 4320) are the low/medium/high colour tiers for video resolution on
  library cards; the `thumbnailResolution*` trio is the same for thumbnail resolution.
- `autoBackupIntervalHours` (`0|6|12|24|72|168`) and `backupRetentionCount` are documented under
  Backup.
- `thumbnailEnhancement*` configure AI Enhancement (see that section); `thumbnailEnhancementPassword`
  is returned in plaintext like `jellyfinApiKey`. `thumbnailEnhancementTargetMode` is
  `"factor"|"resolution"`.

### `PATCH /api/settings` — every field optional, only provided ones are persisted

```json
{ "maxConcurrentDownloads": 5, "libraryView": "folders" }
```

**All-or-nothing:** the whole request is validated first and then written in one transaction, so a
request that answers `400` (or fails to save with `500`) changes nothing and does not touch the live worker
pool; the live effects (worker count, transcode limit) are applied only after the write has committed.

Same field set as the `GET` response. Notes:

- The Library sort is not a setting any more (`librarySortKey`/`librarySortDir` and the stored `library_sort` row were removed;
  clients that still send them are ignored). It lives in the account's saved `library` table layout (`sort.key` is one of
  `downloadedAt`, `title`, `filename`, `year`, `duration`, `sequenceNumber`, `seasonNumber`), see `/api/auth/table-layouts`.
  Restoring an old backup or importing an old settings file skips the retired `library_sort` key.
- `dashboardHiddenWidgets` is the list of Dashboard card IDs to hide (default `[]` = all shown).
  Valid IDs: `downloads`, `library`, `libraryGrowth`, `mediaTypes`, `resolutions`, `storage`,
  `topArtists`, `topTags`. Duplicates are collapsed; an unknown ID is a `400`.
- `maxConcurrentDownloads` **immediately resizes the live worker pool**, no restart needed.
- `downloadDirectory` (`MEDIA_ROOT`) is **not** patchable here — env-config only.

`204 No Content` on success.

### Image derivative backfill

| Method | Path | Description |
|---|---|---|
| POST | `/api/settings/backfill-images` | Start the backfill (no-op if already running) |
| GET | `/api/settings/backfill-images` | Poll current/last run's progress |

Regenerates missing WebP thumbnail/artist-image/collection-cover derivatives for anything that
predates them, and separately backfills `thumbnailWidth`/`thumbnailHeight` (see Library above) for
older items that already have derivatives but never had their dimensions probed. Safe to re-run —
already-migrated items/rows are skipped. Both endpoints return the same status snapshot:

```json
{
  "running": true, "startedAt": "2026-08-22T10:00:00Z", "finishedAt": null,
  "libraryProcessed": 118, "libraryFailed": 2,
  "artistProcessed": 0, "artistFailed": 0,
  "coverProcessed": 0, "coverFailed": 0
}
```

`POST` kicks off the sweep asynchronously and returns the status immediately; calling it again
while already running is a harmless no-op. `finishedAt` stays `null` while `running: true`.

## Backup

| Method | Path | Description |
|---|---|---|
| POST | `/api/backup/export/settings` | Export all settings to a portable bundle |
| POST | `/api/backup/export/library` | Export collections/tags/artists/library refs |
| POST | `/api/backup/import/settings` | Import a settings bundle (also accepts a full-kind file) |
| POST | `/api/backup/preview/library` | Preview a library-bundle import (dry run) |
| POST | `/api/backup/import/library` | Import a library bundle (also accepts a full-kind file) |
| POST | `/api/backup/preview/full` | Preview an ad-hoc uploaded full backup (settings + library) |
| POST | `/api/backup/import/full` | Import an ad-hoc uploaded full backup |
| GET | `/api/backup/history` | List every recorded scheduled/manual backup run |
| POST | `/api/backup/run` | Run a full backup now ("Run Backup Now") |
| GET | `/api/backup/history/:id/download` | Download a backup-history file |
| GET | `/api/backup/history/:id/preview` | Read-only content summary of a history-resident backup |
| POST | `/api/backup/history/:id/restore` | Restore a full backup already sitting in history |
| POST | `/api/backup/history/bulk-delete` | Delete backup-history rows (+ best-effort unlink their files after the commit) |

Three envelope `kind`s exist: `"settings"`, `"library"`, and `"full"` (settings + library
combined — the shape "Run Backup Now" and the scheduler produce). The Settings and Library import
endpoints both accept **either their own kind or `"full"`**, extracting just their own half — so a
full backup file can be fed into any of the three import entry points, not just the dedicated Full
Backup one. Every export/import shares an envelope wrapper:

```json
{
  "packrat": true, "version": 1, "kind": "settings",
  "exportedAt": "2026-07-19T10:00:00Z", "encrypted": false,
  "salt": "", "data": "base64..."
}
```

`data` is base64 of the plaintext JSON payload, or of (nonce + ciphertext) if `encrypted`.

### `POST /api/backup/export/settings` / `POST /api/backup/export/library`

Body: `{ "password": "optional passphrase" }` — omit/empty for an unencrypted export. Response
`200` is an envelope. The settings bundle is a plain `map[string]string` of every raw settings
row. The library bundle:

```json
{
  "collections": [
    {
      "path": ["Shows", "Anime"], "name": "Anime",
      "defaultQuality": "1080p", "defaultDownloadType": "video", "isPrivate": false,
      "jellyfinLibrary": "3c8f6b1a-...", "seasonNumber": 2, "artistName": "Some Artist"
    }
  ],
  "tags": [ { "name": "music", "isPrivate": false } ],
  "artists": ["Some Artist"],
  "libraryItems": [
    {
      "title": "Some Video", "originalUrl": "https://youtube.com/watch?v=abc123",
      "collectionPath": ["Shows", "Anime"], "folder": "", "filename": "Some Video.mp4",
      "downloadType": "video", "quality": "1080p", "artistName": "Some Artist",
      "year": 2023, "seasonNumber": 2, "tags": ["music"]
    }
  ]
}
```

Collections/artists/tags are referenced by path/name, never numeric ID, so a bundle is portable
across installs. **Only library items with a saved `originalUrl` are included — no media bytes are
ever shipped**; re-import re-queues downloads from those URLs. `downloadType`/`quality`/
`audioFormat` are omitted if the originating download row is already gone at export time.

### `POST /api/backup/preview/library` / `POST /api/backup/import/settings` / `POST /api/backup/import/library`

```json
{ "data": "{\"packrat\":true,\"version\":1,...}", "password": null, "mode": "download" }
```

`data` is the raw text of a previously-exported (or full-kind) file. Parses the envelope, checks
`kind` is the endpoint's own or `"full"` (`400` if neither), decrypts if needed (`400` on wrong
password). `mode` (import only, ignored by preview) is `"download"` (default) or `"ghostOnly"`.
Settings import overwrites every key present in the bundle (never deletes keys absent from it) and
live-resizes the worker pool if `maxConcurrentDownloads` was included:

```json
{ "applied": 23 }
```

Library **preview** is read-only — diffs the bundle against the current library without writing
anything, so the frontend can show new-vs-already-in-library counts before committing:

```json
{
  "collections": [ { "path": ["Shows", "Anime"], "name": "Anime", "isNew": false } ],
  "collectionsNew": 1, "tags": ["music"], "tagsNew": 0,
  "artists": ["Some Artist"], "artistsNew": 0,
  "items": [ { "title": "Some Video", "originalUrl": "...", "isNew": true, "isGhost": false } ],
  "alreadyInLibrary": 4
}
```

Library **import** merges: matches collections by path and tags/artists by name, creates only
what's missing, never deletes anything (a name collision on one entry is skipped, not fatal).
`mode: "ghostOnly"` recreates every item as a ghost placeholder (see Ghost items, above) instead
of queuing anything; otherwise every item with a saved URL is queued for redownload (a bare item
with no URL is always created as a ghost regardless of mode — there's nothing to download from). A
missing `downloadType` is inferred from the filename extension before falling back to the app
default. Tags on redownloaded items aren't automatically reapplied — retag once the redownload
finishes.

```json
{ "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 12, "ghostsCreated": 1 }
```

Common errors for all three: `400` for a non-Packrat file, wrong `kind`, or a wrong password;
`500` otherwise.

### Full backup

The full import and restore apply the library first, then the settings (one transaction), then queue the
redownloads. If the library step fails (`500`) the settings are left exactly as they were; the restored
`maxConcurrentDownloads` and `maxConcurrentTranscodes` also take effect on the running server right away.
If the settings write itself fails after the library was applied, the `500` message says so.

`POST /api/backup/preview/full` / `POST /api/backup/import/full` take the same
`{data, password, mode}` body as above, but require exactly `kind: "full"` (they don't accept a
narrower settings-only or library-only file — use the Settings/Library endpoints for those).
Preview `200`:

```json
{
  "settingsCount": 23,
  "library": { "collections": [...], "collectionsNew": 1, "tags": [...], "tagsNew": 0, "artists": [...], "artistsNew": 0, "items": [...], "alreadyInLibrary": 4 }
}
```

`library` is the identical `backup.LibraryBundlePreview` shape `preview/library` returns above.
Import `200`:

```json
{
  "settingsApplied": 23,
  "library": { "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 11, "ghostsCreated": 1 }
}
```

### Backup history

Packrat can back itself up automatically: `PATCH /api/settings` with `autoBackupIntervalHours` set
to `6`/`12`/`24`/`72`/`168` (`0` disables it) turns on a background scheduler that writes a
full settings+library snapshot to disk once the interval has elapsed since the last successful
run — checked on the same shared hourly sweep as history/log retention (see
[architecture.md](architecture.md)), so it's coarse-grained but never needs a dedicated cron.
Automatic/manual disk-resident backups are **always unencrypted** (there's nowhere to prompt for a
password unattended) — use the plain Export cards above for a password-protected file.

- **`GET /api/backup/history`** — every recorded run, most recent first:
  ```json
  [
    {
      "id": 41, "createdAt": "2026-08-22T03:00:00Z", "triggerType": "scheduled",
      "status": "success", "fileName": "backup-20260822-030000-4a1f.json",
      "fileSizeBytes": 184320, "libraryItemsCount": 320, "collectionsCount": 14,
      "tagsCount": 9, "artistsCount": 6, "errorMessage": null
    },
    {
      "id": 40, "createdAt": "2026-08-21T14:12:03Z", "triggerType": "manual",
      "status": "failed", "fileName": null, "fileSizeBytes": null,
      "libraryItemsCount": null, "collectionsCount": null, "tagsCount": null,
      "artistsCount": null, "errorMessage": "writing backup file: disk full"
    }
  ]
  ```
  `triggerType` is `"manual"` (Run Backup Now) or `"scheduled"`. `status` is `"success"`/`"failed"`
  — a failed run is still recorded (with every count/`fileName` field `null`), so this table
  doubles as a health check for the scheduler.
- **`POST /api/backup/run`** — no body. Runs one immediately. `201` with a single history entry
  (same shape as above) even when `status: "failed"` — only a `500` if the history row itself
  couldn't be persisted.
- **`GET /api/backup/history/:id/download`** — no body, streams the file as an attachment. `404`
  unknown row, no file recorded (a failed run), or the file is missing on disk.
- **`GET /api/backup/history/:id/preview`** — read-only, no password (always unencrypted). Same
  not-found cases as download. Response:
  ```json
  {
    "settingsCount": 23,
    "collections": [ { "path": ["Shows", "Anime"], "name": "Anime" } ],
    "tags": ["music", "favorites"], "artists": ["Some Artist"],
    "items": [ { "title": "Some Video", "originalUrl": "...", "collectionPath": ["Shows", "Anime"], "artistName": "Some Artist", "tags": ["music"], "isGhost": false } ]
  }
  ```
- **`POST /api/backup/history/:id/restore`** — body `{ "mode": "download" }` (optional, same
  `download`/`ghostOnly` choice as a plain import). Same not-found cases. `200`:
  ```json
  { "settingsApplied": 23, "library": { "collectionsEnsured": 3, "tagsCreated": 1, "artistsCreated": 1, "downloadsQueued": 11, "ghostsCreated": 1 } }
  ```
- **`POST /api/backup/history/bulk-delete`** — body `{ "ids": [41, 40] }`. The rows are deleted in one
  transaction; after the commit the backup files are removed best effort (a failure is logged).
  Unknown ids are ignored. `200 {"deleted": <n>}`.
- Old backups are pruned automatically after every run, keeping the most recent N **successful**
  ones (setting `backupRetentionCount`, default 14, `0` = unlimited). Failed history rows are
  capped separately at the newest 20 (always, even when unlimited); a failed run only prunes
  failed rows, never a successful backup or its file.

## Import

For files placed under the media root from outside the app (copied in manually, or produced by
another tool) — brings them into the Library without a real download.

| Method | Path | Description |
|---|---|---|
| GET | `/api/import/scan` | List untracked files under `MEDIA_ROOT` |
| POST | `/api/import` | Import one scanned file |

### `GET /api/import/scan` — no params, read-only, safe to re-run

Filters out anything under a configured ignored folder.

```json
[
  {
    "path": "Music/Some Song.mp3", "filename": "Some Song.mp3", "sizeBytes": 8421309,
    "durationSeconds": 214, "resolution": null,
    "collectionPath": "Music", "newCollectionPath": ""
  }
]
```

`newCollectionPath` is the suffix of `collectionPath` that doesn't exist as a collection yet
(`""` if all segments already exist).

### `POST /api/import`

```json
{ "path": "Music/Some Song.mp3", "originalUrl": "https://youtube.com/watch?v=abc" }
```

`path` required, `originalUrl` optional (must be an `http(s)` URL when given, else `400`). Creates any missing collections matching the on-disk
folder chain, probes duration/resolution, resolves a thumbnail (a same-basename sidecar image on
disk first, else — only if `originalUrl` given — a best-effort yt-dlp thumbnail-only fetch), and
creates the library row directly as `status="completed"`. **Never triggers a real download.**
`400` invalid/traversal path or file not found, `409` already imported. Response `201` with the
new library item.

## History

A permanent record of every download attempt, independent of the live Downloads queue.

| Method | Path | Description |
|---|---|---|
| GET | `/api/history` | List all history entries |
| POST | `/api/history/bulk-retry` | Re-queue from history entries (per-item results) |
| POST | `/api/history/bulk-delete` | Delete entries (all-or-nothing) |
| POST | `/api/history/clear` | Delete every entry now |

`GET /api/history` — no params:

```json
{
  "id": 9, "downloadId": 42, "url": "https://...", "title": "Some Video",
  "thumbnail": "...", "status": "completed", "errorMessage": null,
  "createdAt": "2026-07-19T10:00:00Z"
}
```

`status` includes `duplicate` in addition to the usual download statuses. When
"Anonymize History Links" is on (Settings → Privacy), `url` becomes a deterministic hash
placeholder (`"hidden-<12 hex chars>"` — the same URL always anonymizes to the same string) and
`title`/`thumbnail` are nulled too (a title alone can leak what was downloaded), and the URL and
video id, and identifiers derived from the URL (path segments, query values) are replaced by the
same hash inside `errorMessage`. Credentials in URLs (`user:pass@`)
are masked in `errorMessage` regardless of the setting.

`POST /api/history/bulk-retry` — body `{ "ids": [9, 10] }`. Per-item results (see
[Bulk endpoints](#bulk-endpoints)); each success carries `"downloadId"`, the new download. Re-queues
from the entry's URL, reusing the original
type/quality/collection/folder/filename/audioFormat when the source download row still exists.
Also carries over the original request's Title/Artist/Year/Season/Sequence overrides, filename
prefix/template, tags and Generate NFO. If the original run left a ghost library item behind
(`downloads.ghost_library_item_id`) and it still exists and is still a ghost, the new download
fills that same item in instead of creating a second one; that item fails with status `409` if the
ghost already has an active download. Other per-item failures: `404` unknown entry, `400` invalid URL or
folder/collection.

`POST /api/history/bulk-delete` — body `{ "ids": [9, 10] }`, permanent, all-or-nothing in one
transaction; unknown ids are ignored. `200 {"deleted": <n>}`.

`POST /api/history/clear` — no body, deletes every entry regardless of age. `200 {"deleted": <n>}`.

## Logs

| Method | Path |
|---|---|
| GET | `/api/logs` |

No params. Returns the most recent **200** download rows (hard-capped; the cap is applied in SQL
`ORDER BY created_at DESC, id DESC LIMIT 200`, so the cost doesn't grow with the table; unchanged
response) with their captured yt-dlp invocation:

```json
{
  "id": 42, "title": "Some Video", "url": "https://...", "status": "completed",
  "ytdlpCommand": "yt-dlp --dump-json ...", "exitCode": 0,
  "stdoutTail": "...", "stderrTail": "...", "retryCount": 0,
  "errorMessage": null, "createdAt": "...", "completedAt": "..."
}
```

`stdoutTail`/`stderrTail` are the last ~8000 characters. Same URL/title anonymization as History,
gated by the same setting; when it is on, `ytdlpCommand`, `stdoutTail` and `stderrTail` are also
`null` and the URL, video id and URL-derived identifiers inside `errorMessage` become the same hash. Whatever the setting,
`user:pass@` credentials in URLs, the `--proxy` credentials and the `--cookies` path are masked in
the command line (at build time for new rows, and again when responding for older ones) and
credentials are masked in the tails and error text.

## System log

A curated, persistent record of server events (see `docs/FEATURES.md`, "System log"). All routes need a
session and are rejected with `403` while the switch (`featureSystemEventsEnabled`) is off; `DELETE` needs
the CSRF token like every mutating route.

| Method | Path |
|---|---|
| GET | `/api/system-events` |
| GET | `/api/system-events/facets` |
| DELETE | `/api/system-events` |

### Event

```json
{ "id": 7, "createdAt": "2026-11-07T10:15:02Z", "level": "info", "category": "migration",
  "message": "Database migrated",
  "details": { "fromVersion": 53, "toVersion": 54, "durationMs": 12,
               "snapshotFile": "packrat-pre-migration-v53-to-v54.db", "snapshotBytes": 2162688 } }
```

`createdAt` is RFC 3339 in UTC. `details` is a small object or `null`. **Levels:** `info`, `warning`, `error`.
**Categories:** `startup`, `migration`, `recovery`, `shutdown`, `backup`, `restore`, `maintenance`, `ytdlp`,
`security`, `subscription`. Events are never created through the API.

### `GET /api/system-events`

The query is done on the server (parameterized SQL; the sort column goes through an allowlist). All
parameters are optional; an invalid value is a `400 {"error": "…"}`.

| Param | Meaning |
|---|---|
| `level` | `info`, `warning` or `error`; repeat it or comma-separate for several (`level=warning,error`) |
| `category` | one of the categories above; repeat or comma-separate |
| `q` | case-insensitive substring of the message |
| `from`, `to` | RFC 3339 timestamp or `YYYY-MM-DD` (UTC), both ends inclusive; a bare `to` date covers that whole day; `from` after `to` is a `400` |
| `page` | 1-based, default `1` |
| `pageSize` | default `50`, values above `200` are capped to `200` |
| `sort` | `createdAt` (default), `level` or `category` |
| `dir` | `desc` (default) or `asc`; rows with equal keys are ordered by time, then id, in the same direction |

```json
{ "items": [ /* events */ ], "total": 123, "page": 1, "pageSize": 50 }
```

`total` is the number of events matching the filters, across all pages.

### `GET /api/system-events/facets`

```json
{ "levels": [ { "value": "error", "count": 2 }, { "value": "info", "count": 40 } ],
  "categories": [ { "value": "startup", "count": 42 } ] }
```

The values present among **all** stored events with their counts (empty arrays, not `null`, when there are
none), sorted by value. For the filter dropdowns.

### `DELETE /api/system-events`

Body: exactly one of `{ "ids": [1, 2, 3] }` (a non-empty list, at most 1000 per request) or
`{ "all": true }`; neither, both, an empty list or `"all": false` is a `400`. Ids that do not exist are
ignored. One transaction, all or nothing. Returns `{ "deleted": 3 }`. Deleting by filter is not supported, and
a deletion is not itself recorded as an event.

## Subscriptions

Periodically re-checks a saved channel/playlist URL for new uploads. A new upload either becomes a
ghost library placeholder for manual review, or — if auto-download is on — goes straight into the
download queue.

| Method | Path | Description |
|---|---|---|
| POST | `/api/subscriptions` | Create a subscription (baselines existing uploads as already-seen) |
| GET | `/api/subscriptions` | List all subscriptions |
| PATCH | `/api/subscriptions/:id` | Update a subscription (full-state replace, not a partial merge) |
| POST | `/api/subscriptions/bulk-delete` | Delete subscriptions (library items already created are kept) |
| POST | `/api/subscriptions/:id/check` | Check now — synchronous |
| GET | `/api/subscriptions/:id/entries` | List every upload ever seen ("Known items") |
| POST | `/api/subscriptions/:id/entries/bulk-add` | Add known entries as ghosts or downloads (per-item results) |
| POST | `/api/subscriptions/:id/entries/bulk-seen` | Dismiss entries without acting on them |
| POST | `/api/subscriptions/:id/entries/:sourceId/link` | Manually associate an entry with an existing library item |
| POST | `/api/subscriptions/:id/entries/bulk-unlink` | Clear entries' library item associations |

### `POST /api/subscriptions`

```json
{
  "url": "https://youtube.com/@somechannel", "mediaType": "video", "collectionId": 4,
  "tags": ["music"], "autoDownload": false, "generateNfo": true, "checkIntervalHours": 6
}
```

`url` (http/https) and `mediaType` (`video`|`audio`) required; `checkIntervalHours` defaults to 6
if omitted or `<= 0`, and must otherwise be 1–8760 (`400` above that). `400` bad URL/missing fields, `422` initial metadata fetch failed. On success,
every upload currently at the URL is recorded as already-seen (baseline) — subscribing means "tell
me about new uploads from now on," not "queue the whole back catalog." The subscription row, every baseline
entry and `lastCheckedAt` are written in one transaction (on a context that survives the client
disconnecting), so either all of it exists or nothing does: a failure answers `500` and leaves no
subscription. A subscription found with `lastCheckedAt: null` (never baselined) is baselined by its next
check — see `POST /api/subscriptions/:id/check`, which then reports `newItemsFound: 0`. Response `201`:

```json
{
  "id": 3, "url": "https://youtube.com/@somechannel", "title": "Some Channel",
  "mediaType": "video", "collectionId": 4, "collectionName": "Music Videos",
  "tags": ["music"], "autoDownload": false, "generateNfo": true,
  "checkIntervalHours": 6, "enabled": true,
  "lastCheckedAt": "2026-08-22T10:00:00Z", "lastCheckError": null,
  "knownEntryCount": 42, "unseenEntryCount": 0, "createdAt": "2026-08-22T10:00:00Z"
}
```

### `PATCH /api/subscriptions/:id`

```json
{ "collectionId": 4, "tags": ["music"], "autoDownload": true, "generateNfo": true, "checkIntervalHours": 12, "enabled": true }
```

`url`/`mediaType` are immutable after creation (changing the source is really delete-and-re-add).
Every other field required (a real `false`/`0` must be distinguishable from "omitted"). `checkIntervalHours`
must be 1–8760; anything else (`0`, negative, too large) is `400 {"error": "checkIntervalHours must be between 1 and 8760"}`
and nothing is saved. `404` unknown id, `200` with the full updated subscription.

### `POST /api/subscriptions/:id/check` — no body

Same code path as the scheduled sweep, for one subscription, blocking until yt-dlp responds. `404`
unknown id, `502` fetch failure (still records the attempt so it isn't retried every tick),
`409 {"error": "This subscription is already being checked. Try again in a moment."}` when a check for this
subscription (a previous click, another tab, or the scheduled sweep) is still running — nothing is changed.
Response `200 {"newItemsFound": 2}`.

### `GET /api/subscriptions/:id/entries` — no params

Every upload ever seen for this subscription, most-recently-first-seen first
(`first_seen_at DESC, id DESC` — the tiebreak matters because every entry baselined at subscribe
time shares the exact same `firstSeenAt`, so sorting on that column alone left ties in
undefined/unstable order):

```json
[
  {
    "sourceId": "abc123", "title": "New Upload", "url": "https://youtube.com/watch?v=abc123",
    "durationSeconds": 214.0, "libraryItemId": null,
    "seenAt": null, "firstSeenAt": "2026-08-22T09:00:00Z",
    "linkedLibraryItemId": null, "linkedLibraryItemIsGhost": false
  }
]
```

`seenAt: null` means unseen ("New"). An entry recorded before this feature tracked full details has
empty `title`/`url` and `null` `durationSeconds`. `sourceId` is usually the extractor's native video
ID, but falls back to the entry's URL for sources whose flat-playlist listing doesn't provide one —
either way it's stable and unique per subscription. An entry that fails to auto-download/auto-ghost
during a check is still recorded here (`libraryItemId: null`, unseen) rather than silently dropped —
without that, a persistent failure would retry (and fail) on every future check indefinitely, never
visible anywhere. `linkedLibraryItemId`/`linkedLibraryItemIsGhost` report the library item this
entry is *effectively* associated with, if any: `libraryItemId` (set by a prior ghost/download, or
by `/link` below) when present, otherwise a fallback URL/video-id soft match against the whole
library — so a video already present through some other route (a manual download, a different
subscription, an import, or an explicit manual link) shows up linked here even when `libraryItemId`
itself is `null`.

### `POST /api/subscriptions/bulk-delete`

Body `{ "ids": [1, 2] }`. Deletes the subscriptions (and their known entries) in one transaction; unknown
ids are ignored. `200 {"deleted": <n>}`. Needs the Subscriptions feature, like every subscription route.

### `POST /api/subscriptions/:id/entries/bulk-add`

```json
{ "sourceIds": ["abc123", "def456"], "mode": "ghost" }
```

`mode` is `"ghost"` (creates a library placeholder immediately, for review) or `"download"` (queues
a real download right now) — both mark the entry seen as a side effect. Re-adding an entry that's
already linked to a library item is allowed (the frontend confirms first when it detects this); an
existing link is left untouched rather than overwritten by the new ghost/download. `404` if the
subscription does not exist; otherwise per-item results keyed by source id: an unknown entry fails with
`404`, one with no URL recorded (a pre-tracking entry) `400`, a ghost-create/enqueue failure `502`. A
success carries `"libraryItemId"` (ghost) or `"downloadId"` (download). `400` for an unknown `mode`.

### `POST /api/subscriptions/:id/entries/bulk-seen`

Body `{ "sourceIds": ["abc123"] }`. Dismisses the entries without creating anything. All-or-nothing;
source ids that are not entries of the subscription are ignored. `404` unknown subscription;
`200 {"updated": <n>}`.

### `POST /api/subscriptions/:id/entries/:sourceId/link`

```json
{ "libraryItemId": 25 }
```

Manually associates this entry with an existing library item — for when the video was actually
downloaded through a different source/URL than the one this subscription tracks, so the automatic
URL/video-id match could never have found it on its own (surfaced in the "Known items" dialog as
"Link to library item…", a plain search-and-pick over the whole library). Also marks the entry seen.
Multiple entries — even across different subscriptions — can link to the same library item. `404`
unknown subscription/entry/library item, `204` on success.

### `POST /api/subscriptions/:id/entries/bulk-unlink`

Body `{ "sourceIds": ["abc123"] }`. Clears the entries' manual/auto library item association
(`libraryItemId` back to `null`) without touching the library items themselves or the entries' seen
state. A soft URL/video-id match, if one still applies, keeps showing as linked in `linkedLibraryItemId`
regardless. All-or-nothing; unknown source ids are ignored. `404` unknown subscription;
`200 {"updated": <n>}`.

### Automatic checking

Runs on the **same shared hourly ticker** as history/log/thumbnail-enhancement cleanup and
scheduled backups (see [architecture.md](architecture.md)) — once at startup, then every hour. A
subscription is due when `enabled` and `now - lastCheckedAt >= checkIntervalHours` (options: 1h,
6h, 12h, 24h). Each due subscription is checked independently; one failing (dead URL, network
error) is logged and skipped, never blocks the rest. Disabling a subscription only stops the
scheduled checks — "Check now" still works manually while disabled.

## Stats

| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | Headline dashboard counts |
| GET | `/api/stats/library-growth` | Cumulative library item count over time |
| GET | `/api/stats/resolution-breakdown` | Item counts bucketed by resolution step |

No params on any of the three.

```json
{
  "activeDownloads": 2, "queuedDownloads": 5, "completedToday": 14,
  "libraryVideoCount": 320, "libraryAudioCount": 48, "libraryImageCount": 6,
  "libraryVideoGhostCount": 3, "libraryAudioGhostCount": 1, "libraryImageGhostCount": 0,
  "totalStorageBytes": 128849018880,
  "diskTotalBytes": 500107862016, "diskFreeBytes": 128849018880
}
```

`libraryVideo/Audio/ImageGhostCount` are ghost-item (no downloaded file) counts, separate from the
real counts — ghost items are never created with `mediaType=image` today, so
`libraryImageGhostCount` is currently always `0`. `diskTotal/FreeBytes` are best-effort (`0`/`0` if
the filesystem call fails — never fails the whole request).

### `GET /api/stats/library-growth`

Backs the Dashboard "Library Growth" chart — one point per day with any activity, oldest first,
`cumulative` a true running total over the item's entire history:

```json
[
  { "date": "2026-08-18", "count": 3, "cumulative": 314 },
  { "date": "2026-08-20", "count": 6, "cumulative": 320 }
]
```

### `GET /api/stats/resolution-breakdown`

Backs the Dashboard "Items by Resolution" chart — always returns all six standard steps even at
zero, so the chart renders a consistent, fully-labeled bar set:

```json
[
  { "step": 480, "count": 12 }, { "step": 720, "count": 40 }, { "step": 1080, "count": 210 },
  { "step": 1440, "count": 8 }, { "step": 2160, "count": 44 }, { "step": 4320, "count": 0 }
]
```

## Jellyfin

| Method | Path |
|---|---|
| POST | `/api/jellyfin/rescan` |

No body. Triggers a full Jellyfin library scan on demand — there's no automatic trigger tied to
every download (that would mean a burst of rescans during a busy queue); the app instead
auto-triggers/debounces internally per the `jellyfinRefreshMode` setting, and this route is the
manual override. `400` if Jellyfin isn't enabled or configured, `502` if the Jellyfin API call
fails, `204` on success.

## yt-dlp

| Method | Path | Description |
|---|---|---|
| GET | `/api/ytdlp/version` | Current + latest available version |
| POST | `/api/ytdlp/update` | Upgrade yt-dlp via pip |

```json
{ "currentVersion": "2024.08.06", "latestVersion": "2024.09.27", "updateAvailable": true }
```

`latestVersion` is `null` if the best-effort PyPI lookup fails (that alone never fails the
request). `POST /api/ytdlp/update` — no body, `502` on failure (the message says whether yt-dlp was
reinstalled or could not be repaired after the failed update), `409` `{"error": "yt-dlp is already being
updated. Try again in a moment."}` while another update is running, else `200 {"version": "2024.09.27"}`.
The update runs detached from the request: a client that disconnects does not stop it.

## Proxy

The `ytdlp_proxy` setting (Settings → yt-dlp → Proxy, e.g. `socks5://127.0.0.1:1080` or
`http://gluetun:8888`) is read by every outbound fetch that would otherwise leak the server's real
network path: yt-dlp's own `--proxy` flag, `downloadType=image` downloads, and both New Download
preview paths (`GET /api/downloads/preview-image`, above) — a raw client-side `<img src>` fetch has
no way to honor a backend-configured proxy, so those are proxied server-side instead.

| Method | Path | Description |
|---|---|---|
| GET | `/api/proxy/status` | Whether a proxy is configured and currently reachable |

```json
{ "configured": true, "reachable": true }
```

`configured: false` (with `reachable` meaningless/`false`) means no `ytdlp_proxy` is saved — nothing
to probe. When configured, the backend makes a short-timeout (5s) `HEAD` request through it to a
fixed external address to confirm it's actually passing traffic. Backs the sidebar's Downloads
status dot (grey = unconfigured, green = reachable, red = configured but not reachable), polled
every 30s.

## AI Enhancement

See [FEATURES.md](FEATURES.md#ai-enhancement) for what this does and how the three triggers
(manual/scheduled/auto-on-download) work — this is just the endpoint surface.

| Method | Path | Description |
|---|---|---|
| GET | `/api/thumbnail-enhancement/history` | Paginated/searchable attempt history (response unchanged; reads only the page's ≤25 items, not the whole library) |
| DELETE | `/api/thumbnail-enhancement/history/:id` | Delete one history entry |
| POST | `/api/thumbnail-enhancement/history/bulk-delete` | Delete many history entries |
| POST | `/api/thumbnail-enhancement/history/clear` | Delete every history entry |
| POST | `/api/thumbnail-enhancement/run` | Run a sweep now ("Enhance Now") |
| POST | `/api/thumbnail-enhancement/upscalers` | List upscaler models from a (possibly unsaved) instance URL |
| GET | `/api/thumbnail-enhancement/status` | Configured/reachable status |
| GET | `/api/thumbnail-enhancement/eligible` | Every currently-eligible item (uncapped) |
| POST | `/api/thumbnail-enhancement/items/bulk-run` | Enhance a specific set of items now |
| POST | `/api/thumbnail-enhancement/items/bulk-sharpen` | Sharpen (denoise/detail, no resize) a specific set |
| POST | `/api/thumbnail-enhancement/items/:id/revert` | Revert one item to its pre-enhancement backup |
| DELETE | `/api/thumbnail-enhancement/items/:id/original` | Discard one item's backup, keep the enhanced result |
| POST | `/api/thumbnail-enhancement/items/bulk-keep-enhanced` | Bulk-commit enhanced thumbnails, freeing backups |
| POST | `/api/thumbnail-enhancement/items/bulk-keep-original` | Bulk-revert to pre-enhancement thumbnails |

### `GET /api/thumbnail-enhancement/history?q=&status=&trigger=&mode=&page=1`

Fixed page size 25:

```json
{
  "entries": [
    {
      "id": 88, "libraryItemId": 118, "itemTitle": "Some Video",
      "status": "success", "originalWidth": 320, "originalHeight": 180,
      "enhancedWidth": 1280, "enhancedHeight": 720,
      "originalSizeBytes": 8421, "enhancedSizeBytes": 94213, "error": null,
      "createdAt": "2026-08-22T10:00:00Z", "hasOriginalBackup": true,
      "originalThumbnailPath": "thumbnail-backups/118/orig.webp",
      "enhancedThumbnailPath": "Music Videos/Some Video.jpg",
      "revertedAt": null, "triggerType": "manual", "mode": "upscale", "blurred": false
    }
  ],
  "total": 214
}
```

`status` is `"success"`/`"failed"`; `triggerType` is `"manual"`/`"scheduled"`/`"auto"`; `mode` is
`"upscale"`/`"sharpen"`. `hasOriginalBackup`/`originalThumbnailPath`/`enhancedThumbnailPath`
reflect the item's *current* live state, not this specific row — only the most recent success per
item is eligible for Compare/Revert. `originalThumbnailPath` is served via `/local-images/*`,
`enhancedThumbnailPath` via `/media-files/*` — different roots.
`blurred` follows the same rule as library items (the shared `ItemPrivacy` resolver, applied to the
item's *current* collection, artist and tags): `false` when privacy is off, and `false` when the item no
longer exists (`libraryItemId` is `null`). The `q` filter still matches real titles.

`DELETE .../history/:id` — `404`/`204`. `POST .../history/bulk-delete` — `{"ids":[...]}` →
`200 {"deleted": n}` (unknown ids skipped). `POST .../history/clear` — `200 {"deleted": n}`.

### `POST /api/thumbnail-enhancement/run` — no body

Fire-and-forget: counts eligible items synchronously, runs the sweep detached from the request,
responds immediately. `202 {"queued": 7}`. Progress streams over the `enhance_progress` WebSocket
event (see WebSocket, below) rather than blocking this response.

### `POST /api/thumbnail-enhancement/upscalers` — `{url, username?, password?}`

Tests against whatever's currently typed into the Settings form, not necessarily saved yet. The
credentials travel in the JSON body (CSRF-protected), never in the URL; the old `GET` form is gone.
`400` missing `url` or bad body, `502` on failure. `200 {"upscalers": ["R-ESRGAN 4x+", "..."]}`.

### `GET /api/thumbnail-enhancement/status` — no params

```json
{ "configured": true, "reachable": false, "error": "dial tcp: connection refused" }
```

`configured: false` (feature off, or no URL saved) short-circuits to just `{"configured": false}`.

### `GET /api/thumbnail-enhancement/eligible` — no params

Every item the next sweep would pick up, uncapped (a real run stops at the sweep cap):

```json
[
  {
    "libraryItemId": 118, "itemTitle": "Some Video", "width": 320, "height": 180,
    "artistName": "Some Artist", "collectionName": "Music Videos", "recentlyFailedAt": null
  }
]
```

`recentlyFailedAt` is set when the item's last attempt failed within the past hour — automatic
runs skip it during that cooldown, but it still shows here so it stays manually retryable.

### `POST /api/thumbnail-enhancement/items/bulk-run` / `.../items/bulk-sharpen`

```json
{ "itemIds": [1, 2, 3] }
```

`itemIds` required, at least one. `202 {"queued": 3}`. Fire-and-forget; bypasses the sweep cap and
ignores the failure cooldown (explicit selection).

### `POST /api/thumbnail-enhancement/items/:id/revert` / `DELETE .../items/:id/original`

No body either way. `404 {"error":"no original backup for this item"}` if none, else `204` —
revert restores the pre-enhancement thumbnail and discards the enhanced version; delete-original
does the opposite (commits the enhanced result, frees the backup).

### `POST /api/thumbnail-enhancement/items/bulk-keep-enhanced` / `.../items/bulk-keep-original`

```json
{ "itemIds": [1, 2, 3] }
```

`200 {"updated": 2, "skipped": 1}` — an item with no backup (already committed/reverted/never
enhanced) is skipped, not fatal.

## Host actions

Configured by `PACKRAT_ACTION_<N>_*` env vars (see "Host actions" in `FEATURES.md`). Both routes
require a session; URLs and tokens are never returned.

### `GET /api/actions` — no params
```json
[{ "id": "1", "label": "Start Stable Diffusion", "confirm": false }]
```
`id` is the `<N>` from the env vars; the array is ordered by it and empty when none are configured.

### `POST /api/actions/:id/run` — no body
Sends the configured request (15 s timeout) and relays the answer:
```json
{ "ok": true, "status": 202, "message": "Starting Stable Diffusion — the API takes a minute or two to come up" }
```
`200` whenever the target answered — `ok` is whether its status was 2xx, `message` is its JSON
`message` field or the start of its body (≤300 chars). `404` for an unknown id; `502` with
`{ "error": "..." }` when the target couldn't be reached at all.

## Media files

| Method | Path |
|---|---|
| GET | `/media-files/*path` |

Static file server rooted at `MEDIA_ROOT`. Directories are not listed (`404`); only files are served. Requires a valid session cookie but no CSRF header
(GET-only). Responses carry `Cache-Control: no-cache` (not `no-store`) — still revalidates cheaply
via `If-Modified-Since`, but never assumes a stale byte range is fresh, since sidecar thumbnails
get overwritten in place at the same path.

## Resized images

| Method | Path |
|---|---|
| GET | `/api/image` |

Authenticated (session cookie; GET, so no CSRF header). Returns a stored image resized to WebP
(quality 80) — computed once, cached under `CACHE_ROOT`, then served from the cache.

| Query | Required | Notes |
|---|---|---|
| `root` | yes | `media` (`MEDIA_ROOT`) or `images` (`IMAGES_ROOT`) |
| `path` | yes | path relative to that root; traversal outside it is a `400`. Source must be `.jpg`/`.jpeg`/`.png`/`.webp` |
| `w` | yes | max width, one of `320, 480, 720, 1080, 1280, 1920` |
| `h` | no | max height, one of `180, 270, 405, 720, 1080`; fit-inside, never crop/pad |

Output is scaled to fit inside `w × h` preserving aspect ratio and is never upscaled. Errors:
`400` (bad `root`/`path`/extension, `w`/`h` outside the whitelist — never rounded), `404` (source
missing), `500` (ffmpeg failure). Response headers: `Content-Type: image/webp`,
`Cache-Control: no-cache`, `ETag` (the cache key, which includes the source mtime/size),
`Last-Modified` (source mtime); `If-None-Match` / `If-Modified-Since` yield `304`. Not `immutable`.

## WebSocket

| Method | Path |
|---|---|
| GET | `/ws` |

Requires a valid session cookie (carried by the upgrade request). Server → client only — the
socket exists purely to push live deltas; there is no initial snapshot on connect, so the client
fetches current state via REST first and then listens for updates. Ping every 54s, 10s write
deadline; a slow/backed-up client is dropped rather than blocking broadcasts for everyone else.

The connection is bound to the session that opened it (cookie, bearer or `?token=`) and is closed
when that session goes away: on logout, revoking a session, "sign out other sessions" and a
password change, and — as a safety net — on the next ping tick if the session no longer exists or
has expired. Other sessions' connections are unaffected.

Each message is `{ "type": "...", "payload": {...} }`. Eight event types are ever broadcast:

**`progress`** — emitted repeatedly during an active download, throttled to roughly once/sec:
```json
{
  "type": "progress",
  "payload": {
    "downloadId": 42, "status": "downloading", "percent": 43.2,
    "speedBytesPerSec": 1048576, "etaSeconds": 12,
    "downloadedBytes": 5242880, "totalBytes": 12058624
  }
}
```

**`completed`** — once, on success:
```json
{ "type": "completed", "payload": { "downloadId": 42, "libraryId": 118, "title": "Some Video" } }
```

**`failed`** — once, on failure, timeout, or cancel (`status` distinguishes them; a timeout still
uses `"failed"` with a timeout-specific message — `status` is only ever `"failed"` or `"cancelled"`):
```json
{ "type": "failed", "payload": { "downloadId": 42, "status": "failed", "error": "yt-dlp exited 1: ..." } }
```

**`queue_update`** — emitted alongside progress ticks, aggregate queue depth:
```json
{ "type": "queue_update", "payload": { "active": 2, "queued": 5 } }
```

**`enhance_progress`** — one per library item as an AI-enhancement sweep runs, regardless of which
trigger (scheduled, "Enhance Now," bulk-selected, or auto-on-download) started it:
```json
{ "type": "enhance_progress", "payload": { "libraryItemId": 118, "itemTitle": "Some Video", "status": "processing", "error": null } }
```
`status` is `"processing"`, `"success"`, or `"failed"` (then `error` is set).

**`frame_match_progress`** — one per frame-match queue row as it changes state, regardless of
trigger (single ad-hoc job or bulk queue):
```json
{ "type": "frame_match_progress", "payload": { "queueId": 7, "libraryItemId": 118, "itemTitle": "Some Video", "state": "done", "error": null } }
```
`state` is `"running"`, `"done"`, or `"error"` (then `error` is set).

**`library_changed`** — a ghost library item was created or removed by a running download (no item
data, clients just refetch the library); `reason` is `"ghost_created"` or `"ghost_removed"`.
Completion, failure and cancel are already signalled by `completed` / `failed`:
```json
{ "type": "library_changed", "payload": { "libraryId": 118, "reason": "ghost_created" } }
```

**`subscription_new_items`** — once per subscription, only from the *scheduled* background sweep
finding new items (manual "Check now" gets its count synchronously via the HTTP response instead,
so it never broadcasts this):
```json
{ "type": "subscription_new_items", "payload": { "subscriptionId": 4, "subscriptionTitle": "Some Channel", "newCount": 3 } }
```

**`backup_completed`** — only from the *scheduled* auto-backup sweep, and only when it fails (a
manual backup gets its result synchronously via the HTTP response instead, and a routine scheduled
success isn't broadcast — see `backup.RunScheduledBackupIfDue`):
```json
{ "type": "backup_completed", "payload": { "status": "failed", "errorMessage": "writing backup file: ..." } }
```

The WebSocket is a live-delta channel only — clients should treat `GET /api/downloads` and
`GET /api/library` as the source of truth on initial load and on reconnect.
