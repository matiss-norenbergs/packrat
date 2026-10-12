"""Packrat SD launcher — a tiny HTTP service that starts/stops a local
Stable Diffusion WebUI on request, so Packrat (running in Docker on the same
machine) can bring it up for AI enhancement without anyone touching the PC.

Standard library only (Python 3.8+). Run it in your logged-in Windows
session (setup.ps1 registers a Task Scheduler "At log on" task for that) —
a Windows service can't start a GPU desktop app properly.

Endpoints (all require "Authorization: Bearer <token>"):
  GET  /status  -> {"ok", "running", "managed", "apiUp", "message"}
  POST /start   -> starts start_command unless SD is already running/up
  POST /stop    -> stops the process tree this launcher started

Only the command in sd_launcher.json is ever run — requests can't pass
commands, paths or arguments, so a leaked token can at worst start/stop SD.
"""

import hmac
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("SD_LAUNCHER_CONFIG", os.path.join(HERE, "sd_launcher.json"))
LOG_PATH = os.path.join(HERE, "sd_launcher.log")
IS_WINDOWS = os.name == "nt"
MIN_TOKEN_LENGTH = 24

log = logging.getLogger("sd_launcher")


def load_config(path):
    with open(path, encoding="utf-8-sig") as f:  # -sig: tolerate a BOM from PowerShell/Notepad
        cfg = json.load(f)
    token = str(cfg.get("token", ""))
    if len(token) < MIN_TOKEN_LENGTH:
        raise SystemExit(f"config error: token must be at least {MIN_TOKEN_LENGTH} characters (run setup.ps1 to generate one)")
    command = str(cfg.get("start_command", "")).strip()
    if not command:
        raise SystemExit("config error: start_command is required (path to webui-user.bat)")
    if not os.path.isfile(command):
        raise SystemExit(f"config error: start_command {command!r} does not exist")
    return {
        "token": token,
        "bind": str(cfg.get("bind", "127.0.0.1")),
        "port": int(cfg.get("port", 7870)),
        "start_command": os.path.abspath(command),
        "sd_url": str(cfg.get("sd_url", "http://127.0.0.1:7860")),
        "show_console": bool(cfg.get("show_console", True)),
    }


def port_open(url, timeout=1.0):
    """True if something accepts TCP connections at url's host:port — a cheap
    "is the SD API up" check that needs no SD credentials."""
    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class Launcher:
    def __init__(self, cfg):
        self.cfg = cfg
        self.proc = None
        self.lock = threading.Lock()

    def _alive(self):
        return self.proc is not None and self.proc.poll() is None

    def status(self):
        with self.lock:
            managed = self._alive()
        api_up = port_open(self.cfg["sd_url"])
        if api_up:
            msg = "Stable Diffusion is up"
        elif managed:
            msg = "Stable Diffusion is starting"
        else:
            msg = "Stable Diffusion is not running"
        return {"ok": True, "running": managed or api_up, "managed": managed, "apiUp": api_up, "message": msg}

    def start(self):
        with self.lock:
            if self._alive():
                return 200, {"ok": True, "message": "Stable Diffusion is already running"}
            if port_open(self.cfg["sd_url"]):
                # Started by hand (double-clicked .bat) — don't launch a second copy.
                return 200, {"ok": True, "message": "Stable Diffusion is already up (not started by the launcher)"}

            command = self.cfg["start_command"]
            cwd = os.path.dirname(command)
            if IS_WINDOWS:
                flags = subprocess.CREATE_NEW_PROCESS_GROUP
                flags |= subprocess.CREATE_NEW_CONSOLE if self.cfg["show_console"] else subprocess.CREATE_NO_WINDOW
                args = ["cmd.exe", "/c", command]
                self.proc = subprocess.Popen(args, cwd=cwd, creationflags=flags)
            else:  # for local testing on Linux/macOS with a shell script
                self.proc = subprocess.Popen([command], cwd=cwd, start_new_session=True)
            log.info("started %s (pid %d)", command, self.proc.pid)
            return 202, {"ok": True, "message": "Starting Stable Diffusion — the API takes a minute or two to come up"}

    def stop(self):
        with self.lock:
            if not self._alive():
                if port_open(self.cfg["sd_url"]):
                    return 409, {"ok": False, "message": "Stable Diffusion is running but wasn't started by the launcher — close it by hand"}
                return 200, {"ok": True, "message": "Stable Diffusion is not running"}
            pid = self.proc.pid
            if IS_WINDOWS:
                # /T: the .bat spawns cmd -> python -> children; kill the whole tree.
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            else:
                try:
                    os.killpg(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                log.warning("pid %d did not exit within 15s", pid)
            self.proc = None
            log.info("stopped pid %d", pid)
            return 200, {"ok": True, "message": "Stable Diffusion stopped"}


def make_handler(launcher):
    expected = ("Bearer " + launcher.cfg["token"]).encode()

    class Handler(BaseHTTPRequestHandler):
        server_version = "PackratSDLauncher/1"

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self):
            got = self.headers.get("Authorization", "").encode()
            if hmac.compare_digest(got, expected):
                return True
            log.warning("rejected %s %s from %s: bad or missing token", self.command, self.path, self.client_address[0])
            self._send(401, {"ok": False, "message": "unauthorized"})
            return False

        def _drain(self):
            length = int(self.headers.get("Content-Length") or 0)
            if 0 < length <= 65536:
                self.rfile.read(length)

        def do_GET(self):
            if not self._authorized():
                return
            if self.path == "/status":
                self._send(200, launcher.status())
            else:
                self._send(404, {"ok": False, "message": "not found"})

        def do_POST(self):
            self._drain()
            if not self._authorized():
                return
            try:
                if self.path == "/start":
                    self._send(*launcher.start())
                elif self.path == "/stop":
                    self._send(*launcher.stop())
                else:
                    self._send(404, {"ok": False, "message": "not found"})
            except Exception as e:  # report instead of dropping the connection
                log.exception("%s failed", self.path)
                self._send(500, {"ok": False, "message": f"{self.path} failed: {e}"})

        def log_message(self, fmt, *args):
            log.info("%s %s", self.client_address[0], fmt % args)

    return Handler


def main():
    handlers = [logging.FileHandler(LOG_PATH, encoding="utf-8")]
    if sys.stderr is not None:  # None under pythonw.exe
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers)

    cfg = load_config(CONFIG_PATH)
    launcher = Launcher(cfg)
    server = ThreadingHTTPServer((cfg["bind"], cfg["port"]), make_handler(launcher))
    log.info("listening on %s:%d, command %s", cfg["bind"], cfg["port"], cfg["start_command"])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
