# Packrat desktop

A [Tauri v2](https://tauri.app) shell around the existing `frontend/` — a thin **client** for a
Packrat server you already run (Docker or native). It bundles no backend, `yt-dlp` or `ffmpeg`: on
first launch the app asks for the server address, then you sign in as usual (with the server's
optional two-factor auth the password step is followed by a code step; the token is only stored
after it succeeds). The frontend code is
shared with the web UI; everything desktop-specific is gated on running inside Tauri
(`frontend/src/lib/server.ts`), so the Docker-served web app is unchanged.

**Platform support:** **Windows** is the primary target and is tested manually — the checklist is in
[`TESTING.md`](TESTING.md). **Linux** has automated end-to-end tests in CI ([below](#end-to-end-tests))
and is occasionally tried by hand. **macOS** builds in CI but is untested.

## Prerequisites

- Node 22+ and a Rust toolchain (`rustup`, stable).
- Linux: `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev
  librsvg2-dev libdbus-1-dev` (Debian/Ubuntu names). macOS: Xcode command line tools. Windows: WebView2 (preinstalled
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
- **PRs touching `desktop/`, `frontend/` or `backend/`** (`desktop-e2e.yml`, Linux): the end-to-end
  suite below, which runs the real app. Kept out of `ci.yml` and **not a required check** for now.
- **Releases** (`release.yml` → `desktop.yml`): after the Docker image is published, the installers
  are built on Linux (`.deb`, `.rpm`, `.AppImage`), Windows (`.msi`, `.exe`) and macOS (`.dmg`, Apple
  silicon and Intel) and attached to the same GitHub Release. The release version is stamped into
  the installers. A failed desktop leg leaves the Docker release intact — re-run the failed job.
- **Dry run**: once `desktop.yml` is on `main`, *Actions → Desktop → Run workflow* builds the
  installers as downloadable workflow artifacts without releasing anything.

The installers are **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn on first launch
(macOS: right-click → Open). Signing/notarization and the auto-updater need certificates/keys and
aren't set up yet.

## End-to-end tests

`e2e/` holds a self-contained suite (its own `package.json`; nothing in `frontend/` or the release
build depends on it) that launches the real shell — a debug build — against a real Packrat server and
drives it through the official Tauri WebDriver route: `tauri-driver` + WebKitWebDriver under Xvfb,
with [selenium-webdriver](https://www.npmjs.com/package/selenium-webdriver) and Node's test runner.
Each scenario gets a fresh server (temp database/data dirs, free port, `CORS_ALLOWED_ORIGINS` listing
the Tauri origins) and a fresh app profile (a throwaway `HOME`, so the autostart entry, webview storage
and `desktop.json` never touch the machine). What it covers, and what it can't, is in
[`TESTING.md`](TESTING.md); in short: launch, connect/sign-up/log in/out, several servers, Settings →
Desktop with every shell command (the capability check), the Startup select (launch at login), and "Start minimized" without a
tray. The keychain falls back to `localStorage` there (no Secret Service in CI) — that fallback is what
gets exercised.

**Run it locally (Linux):**

```
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev   libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev xvfb x11-utils webkit2gtk-driver
cargo install tauri-driver --locked
(cd ../frontend && npm ci) && npm ci && (cd e2e && npm ci)
cd e2e && xvfb-run -a --server-args="-screen 0 1920x1080x24" npm test
```

`npm test` builds the Go server and the debug app first (needs Go and Rust), then runs the six
scenarios one after another; `E2E_SKIP_BUILD=1` reuses the previous build and
`npm test -- --test-name-pattern=autostart` runs one. On a failure, `e2e/artifacts/<scenario>/` has
`failure-*.png`, the page's HTML and recorded errors/commands, the app log and each server's log (CI
uploads that folder as the `desktop-e2e-artifacts` artifact). On a non-Linux machine, `e2e/Dockerfile` is
a ready-made Linux environment (`docker build -t packrat-desktop-e2e e2e`, then run
`xvfb-run -a npm test` inside it with the repo mounted at `/repo` and `docker run --init`, which reaps the
leftover browser processes; keep `node_modules` and `target/` off
the bind mount, e.g. on named volumes, or it is very slow).

The platform-specific bits (driver binary, autostart location, window check) are isolated in
`e2e/lib/platform.mjs`, so the same scenarios could run on Windows (WebView2 via `msedgedriver`) — that
isn't wired up yet.

## How it fits together

- **Window** — built in `src-tauri/src/main.rs` (not just declared in `tauri.conf.json`) so it can
  carry a download handler: downloads land in the download folder (the OS Downloads folder unless one
  was chosen in Settings → Desktop → Downloads; never overwriting an existing file, and keeping the name the server sent: WebView2 numbers a name that
  exists in the system Downloads folder before we see it — `backup (1).json` — so a trailing ` (N)` is
  stripped when the un-numbered name exists in the folder it was numbered against, see
  `downloads::original_name`), emit `download-started` / `download-finished` events (the frontend turns them into toasts with a
  **Show in folder** action — `hooks/useDownloadToasts.ts`, `opener:allow-reveal-item-in-dir`) and
  raise a "Download complete" OS notification only while the window isn't focused.
- **Save dialog** — with "Ask where to save each download" on (`askWhereToSave` in `desktop.json`,
  like `downloadDir` / `lastSaveDir` read by the Rust side at download time), the download callback
  can't wait for a dialog: the webview calls it on its own thread, which the dialog needs, and the
  destination has to be named before it returns. So the file is fetched into a per-download folder
  under the app cache directory (`…/downloads/<n>/<name>`; works for `blob:` downloads too, which
  can't be re-requested), and when it finishes `tauri-plugin-dialog`'s non-blocking `save_file`
  opens the native Save dialog (file name filled in, starting in `lastSaveDir`, else the download
  folder). Its answer moves the file (copy-and-delete across drives, replacing a file the dialog
  already confirmed) and emits `download-finished` with the final `path` and the `id` of the toast
  that started it; a dismissed dialog deletes the staged file and emits `cancelled: true`, which
  the frontend turns into just dismissing the toast. The staging folder is emptied at startup, so a
  quit or crash mid-download or mid-dialog leaves nothing behind. The webview is not granted any
  `dialog:*` permission (the folder picker for **Change…** is also opened from Rust): the plugin is
  only for the shell's own use.
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
- **Launch at login** — Settings → Desktop → Startup ("Don't start at login" by default); the page calls the
  shell's `autostart_is_enabled` / `autostart_set` commands (`src-tauri/src/autostart.rs`). Linux and macOS
  use `tauri-plugin-autostart`; Windows writes the `Run` value itself, because the plugin leaves the
  exe path unquoted, which breaks for a path with a space (`C:\Users\John Smith\…`): the value is
  `"<exe>" --minimized`, and an unquoted value from an earlier version is rewritten quoted at startup
  (only if it exists — it never turns the entry on). The select reads the OS and never keeps a copy of its own for the login entry: an XDG autostart
  `.desktop` file in `~/.config/autostart` on Linux (for an AppImage it points at the AppImage), a
  `Run` registry value under `HKCU` on Windows, a LaunchAgent on macOS. The entry starts the app with
  `--minimized`. That argument only matters together with the **"Start at login, hidden in the tray"**
  option, which also sets the `startMinimized` pref in `desktop.json` ("Start at login" clears it,
  "Don't start at login" leaves it alone; the select shows hidden only when both are on): then the main
  window is created hidden and the tray icon is the only trace. A launch without the argument (the
  normal way) always shows the window, and so does one where the tray can't be used — building it
  failed, or on Linux nothing on the session bus hosts StatusNotifier indicators
  (`tray::is_available`) — so the app is never invisible. An autostart launch that finds the app
  already running (single instance) does not raise its window. **Not exercised on Windows or macOS**
  (see Known limitations).
- **Reconnect banner** — frontend only (`lib/connection.ts`, `ConnectionBanner`): see
  [`docs/FEATURES.md`](../docs/FEATURES.md#desktop-app-client-mode).
- **CSP** (`tauri.conf.json`) — scripts and styles are local-only, but `connect-src`/`img-src`/
  `media-src` allow any `http(s)`/`ws(s)` host because the server address is entered by the user.
  The window only ever loads the bundled frontend, never the server's pages, and the capability file
  (`capabilities/default.json`) grants no remote origins anything.
- **Auth/storage** — the saved servers ("profiles": `{id, name, url, lastUsedAt}`, plus which one is
  active) live in the webview's `localStorage` (`packrat.profiles`, `packrat.activeProfile`; not secret
  — see `lib/serverProfiles.ts`). Switching a profile sets the active one and reloads, so every query
  starts fresh against that server. Each profile's login **token** lives in the OS secret store —
  Windows Credential Manager, macOS Keychain, or the Linux Secret Service (GNOME Keyring / KWallet) —
  under service `io.github.matiss-norenbergs.packrat`, account `session-token:<profile id>`, via the
  `keyring` crate and the `token_get`/`token_set`/`token_clear`/`token_store_kind` commands in
  `src/token.rs` (all but the last take the profile id, which is restricted to `[A-Za-z0-9_-]{1,64}`).
  Tokens are never part of the profile list. The frontend loads the active profile's token into memory
  before the first render (`initTokenStore` in `lib/server.ts`, called from `main.tsx`), so `getToken()`
  stays synchronous and never serves another profile's token. **Upgrading** from the single-server
  version: the old `packrat.serverUrl` becomes the first profile (named after its host, active), a
  `localStorage` token moves to `packrat.token.<id>`, and the old keychain entry (`session-token`)
  is moved to that profile's account by `token_adopt_legacy` at startup (idempotent; it keeps its own
  token if both exist, and a failed move is retried on the next start, still for the first profile).
  Changing a profile's address or removing it deletes its token. If the keychain is unavailable
  (typically Linux without a running Secret Service) tokens stay in `localStorage`
  (`packrat.token.<id>`) instead of the login being dropped, and Settings → Desktop shows "Token
  storage: Local file (keychain unavailable)". **What this protects:** the token is no longer a readable
  file in the app data directory, so it isn't exposed by disk images, backups or syncs of AppData/the
  home folder. **What it doesn't:** malware already running as your user can ask the keychain for it
  (as can any app on a session that has the keychain unlocked) — it's the same credential a browser
  session would hold. Log out (or remove the server) to discard it.
- **Updates** — manual, from Settings → Desktop → **Check for updates**. Nothing contacts GitHub until
  the button is pressed and nothing installs until **Install and restart** is. The app reads
  `latest.json` from the newest GitHub Release, downloads the update for its platform, verifies its
  signature against the public key in `tauri.conf.json` (`plugins.updater.pubkey`) and only then
  installs and restarts. On **Linux only the AppImage** can update itself; `.deb`/`.rpm` installs
  have to be reinstalled by hand. The first release that contains the updater has to be installed
  manually; every release after it can be updated from inside the app.
- **Match server version** — Settings → Desktop → Updates also offers to install the release equal to
  the server's version (upgrade or downgrade; `src-tauri/src/match_update.rs`). The JS updater can't
  change its endpoint, so the Rust side builds a one-off updater for
  `…/releases/download/v<version>/latest.json`. The version comes from the server, so it is accepted
  only as a plain `X.Y.Z` before any request is made, and the same signature check applies. Debug
  builds (only) honor `PACKRAT_UPDATE_BASE_URL` to point it at a local mock release server.

## Releasing updates (one-time setup)

Updates are signed with a Tauri updater key pair — separate from OS code signing, and not tied to any
machine or user. Generate it **once**:

```
npx @tauri-apps/cli signer generate -w ~/.tauri/packrat-updater.key
```

- Put the **public** key (printed, and in `…key.pub`) in `src-tauri/tauri.conf.json` →
  `plugins.updater.pubkey` (already done).
- Add the private key file's contents and its password as the repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. `desktop.yml` signs each
  platform's update file with them and fails fast if the key is missing.
- **Keep a backup of the private key and never regenerate it**: every installed app trusts this one
  public key, so a new key would leave existing installs unable to update (they would have to be
  reinstalled by hand).

`desktop.yml` also builds `latest.json` (`scripts/update-manifest.mjs`, tested with `npm test`) from
every platform's files and attaches it to the release. A dry run (Actions → Desktop → Run workflow)
builds and checks the manifest without publishing. Local `npm run build` does not need the key — the
update files are only requested by CI (`bundle.createUpdaterArtifacts`).

## Known limitations

- Launch at login was verified on Linux only (the `.desktop` entry under Xvfb); the Windows registry
  `Run` value (our own code since the quoting fix, compile-checked for Windows but not run there) and the
  macOS LaunchAgent (from the plugin) are untested.
- The multiple-server keychain handling (per-profile entries, moving the old single entry) and the
  Save dialog / folder picker were exercised on Linux only (Secret Service and the GTK dialogs under
  Xvfb). Windows Credential Manager entries, the Windows Save dialog and WebView2's download events
  (including whether it reports the same path it was given, which the staging step relies on — a
  canonical-path fallback covers spelling differences) and macOS are untested.
- Developed and exercised on Linux (WebKitGTK) only; macOS (WKWebView) and Windows (WebView2) are
  untested — in particular download handling, notifications and window-state.
- No code signing yet (updates are verified by the updater key, but the installers themselves are
  unsigned). Updates are manual — there is no automatic background update.
