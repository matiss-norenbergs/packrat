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
4. **Settings → Desktop / permissions** — the Downloads, Startup and Updates sections load
   with no "not allowed" errors, "Check for updates" runs, and every custom shell command
   (`get/set_close_to_tray`, `…_start_minimized`, `…_ask_where_to_save`, `get/reset/choose_download_folder`,
   `token_*`, `match_update_check/install`) is invoked once. *This is the capability/ACL regression check.*
5. **Startup select** — "Start at login" creates `~/.config/autostart/*.desktop` with `--minimized`,
   "…hidden in the tray" keeps it and sets the shell pref, "Don't start at login" removes it again (in a
   throwaway `HOME`). *Updated for the select; not yet run in CI.*
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
| W-01 | Install and start Packrat. | The window opens on "Connect to a server". SmartScreen warns once (installer is unsigned) — expected. | Pass 2026-10-24 v0.18.1 — window opens on "Connect to a server"; but SmartScreen did **not** warn at install (tester's report), see Findings |
| W-02 | Enter the server address (e.g. `192.168.1.20:50505`) and press Connect. | The login page (or "Create admin account" on a fresh server) for that server appears; the server's name is shown under the form. | Pass 2026-10-24 v0.18.1 (fresh :51201 server showed "Create admin account") |
| W-03 | Enter a wrong address (`192.168.1.20:1`) and press Connect. | An error is shown under the field; nothing is saved. | Pass 2026-10-24 v0.18.1 — "Couldn't reach the server…" under the field; localStorage empty |
| W-04 | Log in. | The dashboard opens; no "can't reach the server" or CORS-style error. | Pass 2026-10-24 v0.18.1 |

### Keychain (Windows Credential Manager)

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-10 | After W-04, open Credential Manager → Windows Credentials. | An entry for the service `io.github.matiss-norenbergs.packrat` with the user name `session-token:<profile id>` exists. Settings → Desktop shows "Token storage: OS keychain". | Pass 2026-10-24 v0.18.1 — Windows Credentials: user `session-token:<id>`, target `session-token:<id>.io.github.matiss-norenbergs.packrat` |
| W-11 | Add a second server (W-60) and log in. | A second entry `session-token:<other id>` appears; the first is unchanged. | Pass 2026-10-24 v0.18.1 |
| W-12 | Remove the second server in Settings → Desktop → Servers. | Its Credential Manager entry disappears; the first remains. | Pass 2026-10-24 v0.18.1 |
| W-13 | Edit a server's address (Settings → Desktop → Servers → Edit). | The app signs out of that server; its entry is gone. Logging in again creates a new one. | Pass 2026-10-24 v0.18.1 |
| W-14 | **Upgrade:** install a pre-profiles release (one that stores a single `session-token` entry), log in, then install the current version over it. | The app starts signed in; the old `session-token` entry has moved to `session-token:<id>` and the server appears as a profile. | Not run — needs installing an older pre-profiles release over 0.18.1; waiting for your OK |
| W-15 | Quit and relaunch. | Still signed in without asking for credentials. | Pass 2026-10-24 v0.18.1 (quit by closing the window with Close to tray off) |

### Startup (launch at login)

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-20 | Settings → Desktop → Startup → choose **Start at login**. | In `regedit`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has a `Packrat` value whose command ends with `--minimized` and whose exe path is wrapped in double quotes (`"C:\…\packrat-desktop.exe" --minimized`). The select shows "Start at login". | needs re-test after the Startup select (previously passed with the old switch 2026-10-24 v0.18.2) |
| W-21 | Choose **Start at login, hidden in the tray**, sign out of Windows and back in. | Packrat starts hidden: only the tray icon is visible. | needs re-test after the Startup select (previously partial with the old switch: simulated via the Run command, real logon not tested) |
| W-22 | Choose **Start at login** (window shown), sign out and back in. | Packrat starts with its window shown. | needs re-test after the Startup select (previously partial with the old switch: simulated via the Run command, real logon not tested) |
| W-23 | Start the app from the Start menu with **hidden in the tray** selected. | The window is shown (only an autostart launch hides it). | needs re-test after the Startup select |
| W-24 | Choose **Don't start at login**. | The `Run` value is removed; the select shows "Don't start at login". | needs re-test after the Startup select |
| W-25 | Delete the `Run` value in `regedit`, reopen Settings. | The select shows "Don't start at login" (it reflects the OS, not a stored copy). | needs re-test after the Startup select |
| X-1 | With **Start at login** chosen, `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Close the app, overwrite the value with the OLD unquoted form (`reg add … /v Packrat /t REG_SZ /d "<path>\packrat-desktop.exe --minimized" /f`), start the app normally, wait a few seconds. Then choose **Don't start at login** in the app, close the app and start it again. | The value is `"<path>\packrat-desktop.exe" --minimized` (path in double quotes). After the restart the old unquoted value is rewritten quoted. With "Don't start at login", the value is gone and is NOT recreated by a restart. | needs re-test after the Startup select (previously passed 2026-10-24 v0.18.2 — quoted on enable; unquoted value was quoted again ~6 s after start; after turning it off + restart no `Packrat` value (app started with the WebView2 debug-port env var set, otherwise a normal start)) |

### Tray

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-30 | Look at the notification area. | A Packrat icon with the tooltip "Packrat". | Pass 2026-10-24 v0.18.1 — icon sits in the hidden-icons overflow (Windows 11 default); tooltip "Packrat" seen on hover |
| W-31 | With **Close to tray** on (default), press the window's close button. | The window hides; the icon stays; the process keeps running. | Pass 2026-10-24 v0.18.1 |
| W-32 | Left-click the tray icon. | The window is restored and focused. | Pass 2026-10-24 v0.18.1 (left click sent as UI Automation Invoke on the overflow icon) |
| W-33 | Hide the window again, right-click the icon → **Show Packrat**. | The window is restored. | Pass 2026-10-24 v0.18.1 (checked by hand: the menu appears and Show Packrat restores the window) |
| W-34 | Right-click the icon → **Quit**. | The app exits completely (no `Packrat` process in Task Manager). | Pass 2026-10-24 v0.18.1 (Quit clicked by hand; no `packrat-desktop` or app WebView2 process left) |
| W-35 | Turn **Close to tray** off, press close. | The app exits. Relaunch and turn it back on afterwards. | Pass 2026-10-24 v0.18.1 |
| W-36 | With two or more servers saved, right-click the tray icon, hover the tooltip, open **Servers**. | The menu starts with **Servers**, then a separator, **Show Packrat**, **Quit**. The active server has a check mark and the tooltip reads "Packrat — <its name>". With no server (connect screen) there is no submenu and the tooltip is "Packrat". | not tested yet |
| W-37 | Hide the window to the tray, pick another server in **Servers**; then pick the already-checked one. | The window is shown and focused and the app reloads on the picked server without asking to sign in; the check mark and tooltip move to it. Picking the active one only shows the window. | not tested yet |

### Single instance

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-40 | With the app running (window behind another one), start Packrat again from the Start menu. | No second window/process; the running one comes to the front. | Pass 2026-10-24 v0.18.1 |
| W-41 | With the app hidden in the tray, start it again. | The hidden window is shown. | Pass 2026-10-24 v0.18.1 |
| W-42 | With **Start at login** chosen and the app running and visible/behind another window, run the `Run` value's command (`Packrat.exe --minimized`) from a terminal. | Nothing is raised or shown; no second instance. | Pass 2026-10-24 v0.18.1 |

### Downloads and the Save-as dialog

Downloads are done with the backup file: **Backup → Backup History → Download** next to a backup (create one first with **Backup now** if the list is empty).

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-50 | **Ask where to save each download** off. Backup → Backup History → **Download** a backup. | It lands in the Downloads folder (or the folder chosen in Settings) with no dialog, under the server's file name — no " (N)" suffix unless that same name already exists in the TARGET folder; a toast with **Show in folder** appears; the button opens Explorer with the file selected. | Pass 2026-10-24 v0.18.2 — saved as `backup-20260815-094658-e710.json` in Downloads, no suffix; toast "Saved to …" with **Show in folder** (clicked on the 2nd download: Explorer opened on Downloads with the file selected) |
| W-51 | Download the same backup again. | A numbered copy (`name (1).ext`) is created; the first file is untouched. | Pass 2026-10-24 v0.18.2 — second download became `… (1).json`, first file untouched |
| W-52 | Switch the window to another app while a larger download runs. | When it finishes, a Windows notification "Download complete" appears. With the window focused, no notification (toast only). | Pass 2026-10-24 v0.18.1 — tested with a 6 KB file, not a larger one |
| W-53 | Turn **Ask where to save** on, download a backup (Backup → Backup History → **Download**). | The Save dialog opens with the server's file name filled in — it must NOT carry a " (N)" suffix, even if the same name exists in the system Downloads folder (a clash in the folder you save to is the dialog's own overwrite prompt, W-55) — and the last/default folder selected; saving creates the file there, and the toast shows its final path. | Pass 2026-10-24 v0.18.2 — Save dialog pre-filled `backup-20260815-094658-e710.json` (no " (N)") although that name existed in Downloads; started in Downloads; saved to another folder, toast showed the final path; the next dialog opened in that folder with the clean name |
| W-54 | Same, but press Cancel in the dialog. | No file is left anywhere (check the target folder and `%LOCALAPPDATA%\io.github.matiss-norenbergs.packrat\downloads`), and the progress toast is dismissed without an error toast. | Pass 2026-10-24 v0.18.1 |
| W-55 | Save to an existing name and confirm "replace". | The file is replaced, no stray copy. | Pass 2026-10-24 v0.18.1 |
| W-56 | Settings → Desktop → Downloads → **Change…**, pick a folder. | The shown path updates; the next download goes there. **Use default** returns to the OS Downloads folder. | Pass 2026-10-24 v0.18.2 — picked an empty folder: path updated, next download landed there as `backup-20260815-094658-e710.json` (no " (N)"); **Use default** returned to `C:\Users\…\Downloads` |

### Server profiles

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-60 | Sidebar server switcher → **Add server…**, connect the second server, log in. | Both servers are listed with a check on the current one. | Pass 2026-10-24 v0.18.1 |
| W-61 | Switch between them with the switcher. | The app reloads on each and stays signed in; data is that server's. | Pass 2026-10-24 v0.18.1 |
| W-62 | Settings → Desktop → Servers → Edit → change the name. | The new name shows in the list and the switcher without a reload. | Pass 2026-10-24 v0.18.1 |
| W-63 | Edit the address to a working one, save. | The address is checked first; on success the app signs out of that server (token dropped). | Pass 2026-10-24 v0.18.1 |
| W-64 | Edit the address to an unreachable one. | The save is refused with an error; nothing changes. | Pass 2026-10-24 v0.18.1 |
| W-65 | Remove a non-active server. | It disappears; the app stays on the current one. | Pass 2026-10-24 v0.18.1 |
| W-66 | Remove the active server. | The app returns to "Connect to a server" (other saved servers are offered below the form). | Pass 2026-10-24 v0.18.1 |
| X-2 | Add a throwaway server profile, log in, note the session in the SERVER's Settings → Account → Sessions (browser). Remove the server in Settings → Desktop → Servers. Repeat with Edit → change the address to another working one (e.g. `127.0.0.1` instead of `localhost`). | The desktop session is gone from the server's Sessions list after the removal, and after the address change. | Pass 2026-10-24 v0.18.2 — checked via the server's sessions API with a web login (not the browser UI): the `desktop` session disappeared after Remove, and again after the address edit (which also dropped the app to the login screen) |

### Updates

Needs a published release newer than the installed build, or an older/newer server for the
"Match server version" items.

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-70 | Settings → Desktop → Updates → **Check for updates** on the newest release. | "You're up to date." | Pass 2026-10-24 v0.18.1 |
| W-71 | With an older installed build, **Check for updates**. | "Version X is available" with release notes; nothing is installed yet. | Not run — would install a new build; waiting for my OK |
| W-72 | Press **Install and restart**. | Progress is shown; the installer runs passively; the app restarts on the new version. | Not run — would install a new build; waiting for my OK |
| W-73 | Connect to a server running a **newer** release than the app; press **Match server version**. | A confirmation names both versions; confirming installs and restarts on the server's version. | Not run — would install a new build; waiting for my OK (also: no release newer than 0.18.1 exists) |
| W-74 | Connect to a server running an **older** release; press **Match server version**. | The confirmation warns it is an older version; confirming downgrades. | Partial 2026-10-24 v0.18.1 — against a 0.18.0 server the confirmation reads "Install an older version? This replaces v0.18.1 with the older v0.18.0…"; Cancel pressed, downgrade not installed |
| W-75 | Connect to a server whose version has no desktop build. | "No desktop build is published for server version …"; nothing changes. | Pass 2026-10-24 v0.18.1 — 0.14.0 server: "Couldn't check for a matching version: No desktop build is published for server version 0.14.0" |
| W-76 | After an update, check the Updates section. | "You have version <new>", and "Matches your server" when equal. | Partial 2026-10-24 v0.18.1 — no update done; against a 0.18.1 server it shows "You have version 0.18.1." and "Matches your server." |

### Server version and connection notices

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-80 | Connect to a server whose version differs from the app's. | The version-mismatch notice appears with a way to match (and can be dismissed). | Pass 2026-10-24 v0.18.1 — 0.18.0 server: "Your app (v0.18.1) is newer than your server (v0.18.0)…" with Open settings and Dismiss; dismissal survives a reload |
| W-81 | Connect to a server of the same version. | No notice. | Pass 2026-10-24 v0.18.1 |
| W-82 | While signed in, stop the server. | The reconnect banner appears after a moment (with **Retry now**) and keeps retrying. | Pass 2026-10-24 v0.18.1 — "Can't reach the server — retrying…" with Retry now, immediately after the container stopped |
| W-83 | Start the server again. | The banner clears by itself and the app works without a restart. | Pass 2026-10-24 v0.18.1 — cleared within ~8 s of the restart |
| W-84 | Quit, stop the server, relaunch. | "Can't reach the server" with **Retry** and **Change server**; Retry works once the server is back. | Pass 2026-10-24 v0.18.1 |

### Two-factor login and sessions

Needs 2FA enabled on the server account (Settings → Account).

| ID | Steps | Expected | Result |
| --- | --- | --- | --- |
| W-90 | Log out, log in with username and password. | A second step asks for the 6-digit code (OTP boxes: typing advances, pasting a full code fills all boxes). | Pass 2026-10-24 v0.18.1 — a pasted full code fills and auto-submits |
| W-91 | Enter a wrong code. | An error; the boxes clear; the token is not stored (Credential Manager unchanged). | Pass 2026-10-24 v0.18.1 — toast "invalid code", boxes cleared, no new Credential Manager entry |
| W-92 | Enter the right code. | Logged in; the token entry appears. | Pass 2026-10-24 v0.18.1 |
| W-93 | Settings → Account → Sessions. | The desktop app's session is listed and marked as this device. | Pass 2026-10-24 v0.18.1 — "Packrat desktop app on Windows — This device" |
| W-94 | From a browser, sign in to the same server, open Sessions there and revoke the desktop session. | Within a moment the desktop app falls back to the login screen. | Pass 2026-10-24 v0.18.1 — revoked from a web (cookie + CSRF) login through the API rather than the browser UI; login screen ~12 s later |
| X-3 | With 2FA enabled on the throwaway account, log in and enter a wrong code. | The message reads "That code didn't work. Check that your phone's clock is correct and try again." (not "invalid code"); boxes stay on the 2FA step. Disable 2FA again afterwards. | Pass 2026-10-24 v0.18.2 — toast showed the new text (shown twice: the code auto-submitted and Verify was pressed as well); 2FA disabled again afterwards |

### Findings (2026-10-24, v0.18.1)

Run on Windows 11 Pro 25H2 (build 26200.9711), Smart App Control **on**, against the installed
v0.18.1 release. Servers: the `packrat-dev` container (version `dev`) and throwaway containers of the
published 0.18.1, 0.18.0 and 0.14.0 images. The webview was driven through WebView2 remote debugging
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, real mouse/key input events);
native windows (Save dialog, folder picker, tray, notifications) through UI Automation/Win32 and
screenshots. No failures; the points below are the surprises.

- **Pre-filled / saved file names get a needless " (N)" suffix** (W-53, W-54, W-56). The number is
  computed against the *system* Downloads folder, not where the file goes. With **Ask where to save**
  on and `backup-20260815-094658-e710.json` … `(5).json` already in Downloads, the Save dialog
  offered `backup-20260815-094658-e710 (6).json` (the staged file was already
  `…\downloads\0\backup-…-e710 (6).json`). After saving one copy to another folder, the next dialog
  opened in that folder (empty) still offering `… (7).json`. With the dialog off and **Save to** set
  to an empty folder, the file was saved as `…\dl-folder\backup-20260815-094658-e710 (7).json`.
  Expected: the server's file name (FEATURES.md: "with the server's file name filled in"; "A file
  with the same name is never overwritten: it gets a number added", i.e. only on a clash in the
  target folder).
- **Checklist precondition doesn't match the app:** v0.18.1 has no "Library → item → Download"
  (save to this computer) action; the Library item menu only has server-side **Redownload**. The
  Downloads items were run with Backup → Backup History → Download (a server file behind
  `<a download>`), which goes through the same download handler.
- **Removing a server or changing its address leaves its server-side session alive.** The local
  token is deleted as expected, but the session stays valid on the server: after W-63, server B
  still listed the earlier desktop session (last seen at the address change); after removing server
  C (W-65), its session was still listed on C. The Remove dialog says "The server itself isn't
  affected", so this may be intended; W-13's "the app signs out of that server" reads stronger.
- **No SmartScreen warning at install** (W-01, tester's report), although the installer is unsigned
  and Smart App Control is on. The app installs and runs fine; the checklist's "SmartScreen warns
  once" doesn't hold on this machine (installer downloaded from the GitHub release).
- The `Run` value's path is unquoted (`C:\Users\…\Packrat\packrat-desktop.exe --minimized`). Fine
  here; a user folder with spaces would rely on Windows' unquoted-path parsing.
- A wrong 2FA code shows the raw server text "invalid code" (lowercase) as a toast (cosmetic).
- Test-method notes, not app bugs: a *script-generated* click on a second download made WebView2
  show "http://tauri.localhost wants to Download multiple files [Block] [Allow]"; real mouse clicks
  never triggered it (six downloads in a row). The automated tray right-click (W-33) landed on the
  tooltip instead of the icon; done by hand, the menu works.

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
