# Packrat desktop

A [Tauri v2](https://tauri.app) shell around the existing `frontend/` — a thin **client** for a
Packrat server you already run (Docker or native). It bundles no backend, `yt-dlp` or `ffmpeg`: on
first launch the app asks for the server address, then you sign in as usual. The frontend code is
shared with the web UI; everything desktop-specific is gated on running inside Tauri
(`frontend/src/lib/server.ts`), so the Docker-served web app is unchanged.

## Prerequisites

- Node 22+ and a Rust toolchain (`rustup`, stable).
- Linux: `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev
  librsvg2-dev` (Debian/Ubuntu names). macOS: Xcode command line tools. Windows: WebView2 (preinstalled
  on Windows 11) and the MSVC build tools. See Tauri's
  [prerequisites](https://tauri.app/start/prerequisites/).
- A reachable Packrat server that includes the desktop auth support (bearer tokens + CORS).

## Develop

```
cd desktop
npm install
npm run dev
```

`tauri dev` starts the frontend's Vite dev server (`frontend/`, port 5173) and opens the app on it.
The page's origin is then `http://localhost:5173`, so the **server** must allow it:

```
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

(That variable *replaces* the built-in defaults — the production app origins `tauri://localhost`,
`http://tauri.localhost`, `https://tauri.localhost` — so list those too if you use both.)

## Build

```
cd desktop
npm run build
```

Runs `frontend`'s production build, embeds it, and produces the installers/bundles for the current
OS under `src-tauri/target/release/bundle/`. Builds are per-OS (no cross-compiling), so the other
platforms come from CI:

- **Every PR** (`ci.yml`, `desktop` job, Linux): `cargo fmt --check`, `cargo clippy -D warnings` and
  `cargo test`, so the Rust side can't silently break.
- **Releases** (`release.yml` → `desktop.yml`): after the Docker image is published, the installers
  are built on Linux (`.deb`, `.rpm`, `.AppImage`), Windows (`.msi`, `.exe`) and macOS (`.dmg`, Apple
  silicon and Intel) and attached to the same GitHub Release. The release version is stamped into
  the installers. A failed desktop leg leaves the Docker release intact — re-run the failed job.
- **Dry run**: once `desktop.yml` is on `main`, *Actions → Desktop → Run workflow* builds the
  installers as downloadable workflow artifacts without releasing anything.

The installers are **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn on first launch
(macOS: right-click → Open). Signing/notarization and the auto-updater need certificates/keys and
aren't set up yet.

## How it fits together

- **Window** — built in `src-tauri/src/main.rs` (not just declared in `tauri.conf.json`) so it can
  carry a download handler: backup downloads land in the OS Downloads folder (never overwriting an
  existing file) and raise a "Download complete" notification.
- **Plugins** — `notification` (OS notifications; the webview's own `Notification` API is unreliable
  across the three webviews), `opener` (http(s) links open in the system browser —
  `frontend/src/lib/desktop.ts`), `window-state` (remembers size/position), `single-instance` (a
  second launch focuses the running window instead of opening another).
- **Tray and close-to-tray** — `src/tray.rs` builds the tray icon (left click or "Show Packrat"
  restores the window, "Quit" exits). The "Close to tray" preference (Settings → Desktop, default
  on) is kept by the Rust side in `desktop.json` in the app config directory (`src/prefs.rs`),
  because it must be known the moment the close button is pressed; the frontend reads and writes it
  through the `get_close_to_tray`/`set_close_to_tray` commands. On Linux the tray needs a desktop
  that shows app-indicator icons (GNOME needs an extension).
- **Reconnect banner** — frontend only (`lib/connection.ts`, `ConnectionBanner`): see
  [`docs/FEATURES.md`](../docs/FEATURES.md#desktop-app-client-mode).
- **CSP** (`tauri.conf.json`) — scripts and styles are local-only, but `connect-src`/`img-src`/
  `media-src` allow any `http(s)`/`ws(s)` host because the server address is entered by the user.
  The window only ever loads the bundled frontend, never the server's pages, and the capability file
  (`capabilities/default.json`) grants no remote origins anything.
- **Auth/storage** — the server address and bearer token live in the webview's `localStorage`
  (persisted in the app's data directory, **not encrypted**). The token is the same credential a
  browser session cookie would be; log out (or change server) to discard it. Moving it into the OS
  keychain is a possible hardening step.

## Known limitations

- Developed and exercised on Linux (WebKitGTK) only; macOS (WKWebView) and Windows (WebView2) are
  untested — in particular download handling, notifications and window-state.
- No auto-update or code signing yet.
