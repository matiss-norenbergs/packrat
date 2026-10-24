# Testing the desktop app

What is checked automatically, what has to be checked by hand, and what isn't checked at all.
Platform summary: **Windows** is the primary target and is tested **manually** (checklist below);
**Linux** has automated end-to-end tests in CI (and is occasionally tried by hand); **macOS** builds
in CI but is **untested**.

## 1. What CI covers (Linux only)

| Where | What | Catches |
| --- | --- | --- |
| `ci.yml` → `desktop` job (every PR) | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, the update-manifest generator's tests | Rust that doesn't compile or lint, logic regressions in `prefs`/`token`/`downloads`/`match_update` |
| `ci.yml` → `frontend` job (every PR) | `tsc`, ESLint, Vitest | Frontend logic and component behavior with the Tauri APIs mocked |
| [`desktop-e2e.yml`](../.github/workflows/desktop-e2e.yml) (PRs touching `desktop/`, `frontend/`, `backend/`, `database/`, or the workflow; manual dispatch) | The real shell — a debug build — against a real Packrat server, under Xvfb, driven with `tauri-driver` + WebKitWebDriver. Suite: [`e2e/`](e2e/) | Missing capability permissions, startup panics, shell ⇄ server problems (CORS, bearer-token login), regressions in the profile/Settings flows |

The end-to-end scenarios (`desktop/e2e/scenarios/`):

1. **Launch** — the app starts and shows "Connect to a server"; no page errors, failed commands or panics.
2. **Connect and sign in** — connect to the real server, create the admin account, reach the app, log
   out, log in, restart the app and still be signed in.
3. **Profiles** — add a second server (a second server instance), switch both ways staying signed in
   on each, rename a profile, remove a profile (its token goes), remove the last one.
4. **Settings → Desktop / permissions** — the Downloads, Launch-at-login and Updates sections load
   with no "not allowed" errors, "Check for updates" runs, and every custom shell command
   (`get/set_close_to_tray`, `…_start_minimized`, `…_ask_where_to_save`, `get/reset/choose_download_folder`,
   `token_*`, `match_update_check/install`) is invoked once. *This is the capability/ACL regression check.*
5. **Launch at login** — the switch creates `~/.config/autostart/*.desktop` with `--minimized` and
   removes it again (in a throwaway `HOME`).
6. **Hidden start without a tray** — `--minimized` + "Start minimized" with no tray available (as in
   CI): the window must still be shown (checked with `xwininfo`, i.e. by the window system).

Not-quite-real conditions of the CI run, on purpose:

- **No Secret Service**, so the keychain is unreachable and the login token takes the documented
  fallback to `localStorage` (Settings shows "Token storage: Local file (keychain unavailable)").
  That fallback is what is exercised — the real keychain path is not (see Known gaps).
- **No tray host** (no session bus), which is what scenario 6 relies on.
- Native dialogs (Save as, folder picker) are opened but not operated.
- The updater's check against GitHub depends on the network; the scenario only requires that the
  outcome is not a permission error. "Match server version" is tested against a local mock release
  server (a debug-build-only override), so nothing is installed.

**Keep `desktop-e2e` a non-required check for now.** Branch protection is configured outside this
repository; until the suite has proven stable on GitHub's runners, make sure it is not in the required
checks, so a flaky run can't block a merge. A failure is still visible on the PR, and the run uploads
screenshots and logs as the `desktop-e2e-artifacts` workflow artifact.

## 2. Manual checklist (Windows)

Run before a release (and after touching the shell). Use a Windows 10/11 machine, the installer from
the release (or `npm run build` output), and a reachable Packrat server — plus a second one for the
profile items (a second Docker container on another port is enough). Fill in the **Result** column
as `Pass`/`Fail`/`Not run`, with the date and the app version (Settings → Desktop → Updates).

Start from a clean state unless an item says otherwise: uninstall, delete `%APPDATA%\io.github.matiss-norenbergs.packrat`
and `%LOCALAPPDATA%\io.github.matiss-norenbergs.packrat`, and remove the app's entries in Credential
Manager (*Control Panel → Credential Manager → Windows Credentials*, entries named
`session-token:…` / `session-token` for target `io.github.matiss-norenbergs.packrat`).

### First launch

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-01 | Install and start Packrat. | The window opens on "Connect to a server". SmartScreen warns once (installer is unsigned) — expected. | |
| W-02 | Enter the server address (e.g. `192.168.1.20:50505`) and press Connect. | The login page (or "Create admin account" on a fresh server) for that server appears; the server's name is shown under the form. | |
| W-03 | Enter a wrong address (`192.168.1.20:1`) and press Connect. | An error is shown under the field; nothing is saved. | |
| W-04 | Log in. | The dashboard opens; no "can't reach the server" or CORS-style error. | |

### Keychain (Windows Credential Manager)

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-10 | After W-04, open Credential Manager → Windows Credentials. | An entry for the service `io.github.matiss-norenbergs.packrat` with the user name `session-token:<profile id>` exists. Settings → Desktop shows "Token storage: OS keychain". | |
| W-11 | Add a second server (W-60) and log in. | A second entry `session-token:<other id>` appears; the first is unchanged. | |
| W-12 | Remove the second server in Settings → Desktop → Servers. | Its Credential Manager entry disappears; the first remains. | |
| W-13 | Edit a server's address (Settings → Desktop → Servers → Edit). | The app signs out of that server; its entry is gone. Logging in again creates a new one. | |
| W-14 | **Upgrade:** install a pre-profiles release (one that stores a single `session-token` entry), log in, then install the current version over it. | The app starts signed in; the old `session-token` entry has moved to `session-token:<id>` and the server appears as a profile. | |
| W-15 | Quit and relaunch. | Still signed in without asking for credentials. | |

### Launch at login

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-20 | Settings → Desktop → turn **Launch at login** on. | In `regedit`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has a `Packrat` value whose command ends with `--minimized`. The "Start minimized to tray" switch appears. | |
| W-21 | Turn **Start minimized to tray** on, sign out of Windows and back in. | Packrat starts hidden: only the tray icon is visible. | |
| W-22 | Turn **Start minimized to tray** off, sign out and back in. | Packrat starts with its window shown. | |
| W-23 | Start the app from the Start menu with the option on. | The window is shown (only an autostart launch hides it). | |
| W-24 | Turn **Launch at login** off. | The `Run` value is removed; the "Start minimized" switch disappears. | |
| W-25 | Delete the `Run` value in `regedit`, reopen Settings. | The switch is off (it reflects the OS, not a stored copy). | |

### Tray

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-30 | Look at the notification area. | A Packrat icon with the tooltip "Packrat". | |
| W-31 | With **Close to tray** on (default), press the window's close button. | The window hides; the icon stays; the process keeps running. | |
| W-32 | Left-click the tray icon. | The window is restored and focused. | |
| W-33 | Hide the window again, right-click the icon → **Show Packrat**. | The window is restored. | |
| W-34 | Right-click the icon → **Quit**. | The app exits completely (no `Packrat` process in Task Manager). | |
| W-35 | Turn **Close to tray** off, press close. | The app exits. Relaunch and turn it back on afterwards. | |

### Single instance

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-40 | With the app running (window behind another one), start Packrat again from the Start menu. | No second window/process; the running one comes to the front. | |
| W-41 | With the app hidden in the tray, start it again. | The hidden window is shown. | |
| W-42 | With **Launch at login** on and the app running and visible/behind another window, run the `Run` value's command (`Packrat.exe --minimized`) from a terminal. | Nothing is raised or shown; no second instance. | |

### Downloads and the Save-as dialog

Needs a library item that can be downloaded from the server (Library → item → Download).

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-50 | **Ask where to save each download** off. Download an item. | It lands in the Downloads folder (or the folder chosen in Settings) with no dialog; a toast with **Show in folder** appears; the button opens Explorer with the file selected. | |
| W-51 | Download the same item again. | A numbered copy (`name (1).ext`) is created; the first file is untouched. | |
| W-52 | Switch the window to another app while a larger download runs. | When it finishes, a Windows notification "Download complete" appears. With the window focused, no notification (toast only). | |
| W-53 | Turn **Ask where to save** on, download an item. | The Save dialog opens with the file name filled in and the last/default folder selected; saving creates the file there, and the toast shows its final path. | |
| W-54 | Same, but press Cancel in the dialog. | No file is left anywhere (check the target folder and `%LOCALAPPDATA%\io.github.matiss-norenbergs.packrat\downloads`), and the progress toast is dismissed without an error toast. | |
| W-55 | Save to an existing name and confirm "replace". | The file is replaced, no stray copy. | |
| W-56 | Settings → Desktop → Downloads → **Change…**, pick a folder. | The shown path updates; the next download goes there. **Use default** returns to the OS Downloads folder. | |

### Server profiles

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-60 | Sidebar server switcher → **Add server…**, connect the second server, log in. | Both servers are listed with a check on the current one. | |
| W-61 | Switch between them with the switcher. | The app reloads on each and stays signed in; data is that server's. | |
| W-62 | Settings → Desktop → Servers → Edit → change the name. | The new name shows in the list and the switcher without a reload. | |
| W-63 | Edit the address to a working one, save. | The address is checked first; on success the app signs out of that server (token dropped). | |
| W-64 | Edit the address to an unreachable one. | The save is refused with an error; nothing changes. | |
| W-65 | Remove a non-active server. | It disappears; the app stays on the current one. | |
| W-66 | Remove the active server. | The app returns to "Connect to a server" (other saved servers are offered below the form). | |

### Updates

Needs a published release newer than the installed build, or an older/newer server for the
"Match server version" items.

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-70 | Settings → Desktop → Updates → **Check for updates** on the newest release. | "You're up to date." | |
| W-71 | With an older installed build, **Check for updates**. | "Version X is available" with release notes; nothing is installed yet. | |
| W-72 | Press **Install and restart**. | Progress is shown; the installer runs passively; the app restarts on the new version. | |
| W-73 | Connect to a server running a **newer** release than the app; press **Match server version**. | A confirmation names both versions; confirming installs and restarts on the server's version. | |
| W-74 | Connect to a server running an **older** release; press **Match server version**. | The confirmation warns it is an older version; confirming downgrades. | |
| W-75 | Connect to a server whose version has no desktop build. | "No desktop build is published for server version …"; nothing changes. | |
| W-76 | After an update, check the Updates section. | "You have version <new>", and "Matches your server" when equal. | |

### Server version and connection notices

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-80 | Connect to a server whose version differs from the app's. | The version-mismatch notice appears with a way to match (and can be dismissed). | |
| W-81 | Connect to a server of the same version. | No notice. | |
| W-82 | While signed in, stop the server. | The reconnect banner appears after a moment (with **Retry now**) and keeps retrying. | |
| W-83 | Start the server again. | The banner clears by itself and the app works without a restart. | |
| W-84 | Quit, stop the server, relaunch. | "Can't reach the server" with **Retry** and **Change server**; Retry works once the server is back. | |

### Two-factor login and sessions

Needs 2FA enabled on the server account (Settings → Account).

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-90 | Log out, log in with username and password. | A second step asks for the 6-digit code (OTP boxes: typing advances, pasting a full code fills all boxes). | |
| W-91 | Enter a wrong code. | An error; the boxes clear; the token is not stored (Credential Manager unchanged). | |
| W-92 | Enter the right code. | Logged in; the token entry appears. | |
| W-93 | Settings → Account → Sessions. | The desktop app's session is listed and marked as this device. | |
| W-94 | From a browser, sign in to the same server, open Sessions there and revoke the desktop session. | Within a moment the desktop app falls back to the login screen. | |

## 3. Known gaps

- **macOS** is not tested at all and not supported: the installers build in CI, but nothing has been
  run on a Mac (WKWebView downloads, notifications, window-state, the LaunchAgent for launch at login
  and the Keychain are all untested).
- **The real keychain is not covered in CI.** The end-to-end run has no Secret Service, so only the
  `localStorage` fallback runs; the keychain code is covered by unit tests with a fake store, and on
  Windows by W-10…W-15. The Linux Secret Service path has only been tried by hand.
- **Native dialogs are not automated** — the Save-as dialog and the folder picker (W-53…W-56), and
  the tray (W-30…W-35; CI has no tray host), the OS notification (W-52) and registry/autostart on
  Windows (W-20…W-25).
- **Windows end-to-end automation** (WebView2 via `msedgedriver`) is not set up; the suite is
  structured so the platform-specific parts live in `e2e/lib/platform.mjs`.
- **Updates are not installed in CI**: the install path is only run against a mock whose payload
  fails the signature check; a real signed update is a manual test (W-71…W-75).
