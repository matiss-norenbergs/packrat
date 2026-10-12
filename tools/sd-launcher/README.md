# SD launcher

A small HTTP service that starts and stops a local Stable Diffusion WebUI on request, so Packrat can
bring it up for AI enhancement from its **Actions** menu without anyone touching the PC. It runs on
the Windows machine that hosts Stable Diffusion, not inside Packrat's container.

```
Packrat (Docker) ──POST /start + token──► sd_launcher.py (127.0.0.1:7870) ──► webui-user.bat
```

- Python 3.8+, standard library only.
- Only the command in `sd_launcher.json` is ever run. Requests can't pass commands, paths or
  arguments, so a leaked token can at worst start or stop Stable Diffusion.
- Listens on `127.0.0.1` by default, so nothing else on the network can reach it. Packrat reaches it
  through `host.docker.internal`, which Docker Desktop forwards to the host's localhost.

## Setup (Windows, Packrat on the same machine)

1. Install Python 3 from python.org with "Add python.exe to PATH" ticked.
2. Copy this folder somewhere permanent, e.g. `C:\Tools\sd-launcher`.
3. In PowerShell, from that folder:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -StartCommand "C:\stable-diffusion-webui\webui-user.bat"
   ```
   This generates a random token into `sd_launcher.json`, registers a Task Scheduler task that starts
   the launcher whenever you log on (and restarts it if it crashes), starts it now, and prints the
   `PACKRAT_ACTION_*` lines to add to Packrat.
4. Add those lines to the `environment:` section of `docker/docker-compose.yml` (or your `.env`) and
   recreate the container: `docker compose up -d`.

The **Actions** button then appears at the bottom of Packrat's sidebar.

Options for `setup.ps1`: `-Port` (default 7870), `-SdUrl` (default `http://127.0.0.1:7860`, used to
detect an already-running instance), `-Uninstall` (removes the scheduled task).

## Config (`sd_launcher.json`)

| Key | Default | Meaning |
| --- | --- | --- |
| `token` | — | Shared secret, at least 24 characters. Packrat sends it as `Authorization: Bearer …`. |
| `bind` | `127.0.0.1` | Address to listen on. Keep localhost when Packrat runs on the same machine. |
| `port` | `7870` | Port to listen on. |
| `start_command` | — | Path to `webui-user.bat`. Run from its own folder. |
| `sd_url` | `http://127.0.0.1:7860` | Where the SD API answers; used to report status and avoid starting a second copy. |
| `show_console` | `true` | Open SD in its own console window, like double-clicking the `.bat`. `false` hides it. |

Edit the file and restart the task (Task Scheduler → "Packrat SD Launcher" → End, then Run) to apply
changes. Logs go to `sd_launcher.log` next to the script.

## Endpoints

All require `Authorization: Bearer <token>`.

| Request | Result |
| --- | --- |
| `POST /start` | `202` starting; `200` if it's already running (including one you started by hand). |
| `POST /stop` | `200` stopped (kills the whole process tree it started); `409` if SD is running but wasn't started by the launcher. |
| `GET /status` | `{"running", "managed", "apiUp", "message"}` |

Every response carries a `message`, which Packrat shows as a toast.

## Notes

- The launcher must run in your logged-in session; Windows services can't start GPU desktop apps
  properly. After a reboot it starts once you log on. Locked screen is fine.
- Starting SD takes as long as it does when you double-click the `.bat` (often 1-2 minutes). The AI
  Enhancement status dot in Packrat's sidebar turns green when the API is up.
- Packrat on a different machine: set `bind` to `0.0.0.0`, allow the port only from Packrat's IP
  (`New-NetFirewallRule -DisplayName "SD Launcher" -Direction Inbound -Protocol TCP -LocalPort 7870 -RemoteAddress <packrat-ip> -Action Allow`),
  use that PC's LAN IP in the action URLs, and never port-forward it. The token travels as plain HTTP,
  which is fine on a home LAN but not over the internet.
