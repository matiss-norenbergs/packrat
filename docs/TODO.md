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
- **Clean up old sessions (S).** Expired sessions are never deleted from the database; they don't show in
  the Sessions list or work, they just accumulate. A sweep (hourly, like the log retention sweeps) would do.
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
- **Image loading (S to M).** From [`live-image-resize.md`](live-image-resize.md): `loading="lazy"` and
  `decoding="async"` on the tile images; live resizing for the pick-from-folder dialogs and the Frame
  Matching review page; an optional size cap with eviction for the resized-image cache if it grows large.

## Dependencies

- **Node 22 to the next LTS (S).** Moved by hand across the Dockerfile and the three workflows (Dependabot
  ignores Node major versions on purpose). Do it when 22 nears end of life.
