# Packrat

Self-hosted web app that wraps `yt-dlp` and `ffmpeg` behind a modern UI, turning media downloads
into a searchable, Jellyfin-friendly library — inspired by Sonarr/Radarr, but for general web
media instead of TV/movies.

> Only download content you have the right to download.

## Legal

Packrat is a tool for downloading media you already have the rights to — your own uploads, content
under a permissive license, or anything else you're legally entitled to download and keep a copy
of. It does not circumvent DRM and is not intended for downloading copyrighted material without
permission. You are responsible for how you use it and for complying with the terms of service of
any site you point it at.

## Status

Well past the original ["working skeleton"](../docker-app-plan.md) starting point — the core
download → library flow, plus collections, tags, artists, playlist/batch downloads, full-text
search, private-content blurring, NFO sidecars, Jellyfin auto-refresh, encrypted backup/restore,
AI-powered thumbnail upscaling via a self-hosted Stable Diffusion instance, and session auth with
CSRF protection are all implemented. See [`docs/FEATURES.md`](docs/FEATURES.md)
for a page-by-page guide to everything that's implemented, [`docs/api.md`](docs/api.md) for the
full REST/WebSocket surface, and [`docs/architecture.md`](docs/architecture.md) for how it's built
and what's still deliberately out of scope.

## Stack

- Backend: Go + Gin, SQLite (WAL mode), `golang-migrate`
- Frontend: React + TypeScript + Vite + TanStack Query + React Router + Tailwind CSS + shadcn/ui
- Downloader: `yt-dlp` + `ffmpeg`, invoked as subprocesses (never reimplemented)
- Container: Docker Compose, single image serving API + built frontend

## Development

Requirements: Go 1.23+, Node 20+, `yt-dlp` and `ffmpeg` on `PATH`.

```
cp .env.example .env

# backend (from backend/)
go run ./cmd/server

# frontend (from frontend/)
npm install
npm run dev
```

Or run everything in Docker:

```
docker compose -f docker/docker-compose.yml up --build
```

The app listens on `http://localhost:50505`.

### Dependabot

`.github/dependabot.yml` opens dependency PRs every Monday for Go (`/backend`), npm (`/frontend`,
`/desktop`), Cargo (`/desktop/src-tauri`), GitHub Actions and the Dockerfile (`/docker`), labelled
`dependencies` with a `Deps:` subject. Minor and patch bumps come as **one grouped PR per ecosystem**;
major bumps are separate PRs. Handling them:

- Wait for CI (it runs for Dependabot PRs like any other; the Docker job just skips the Docker Hub
  login, since Dependabot can't read Actions secrets, and pulls anonymously).
- Skim the release notes of major bumps, and keep the `tauri*` crates (Cargo) and `@tauri-apps/*`
  packages (npm) on matching versions, so merge or close those PRs together.
- Dependabot compares versions semver-style, so a `0.x` "minor" bump can still be breaking.
- A PR that needs more work can be pushed to directly; `@dependabot rebase` refreshes it, `@dependabot
  ignore this major version` silences a bump you don't want.
- Merge, don't auto-merge: nothing here enables it.

### Docker dev container

`docker/docker-compose.dev.yml` is a Compose override for iterating without a native Go/Node
toolchain (or when one is blocked locally — e.g. Windows Application Control rejecting freshly
built, unsigned binaries): same image, but named `packrat-dev`, mapped to host port `51200`
instead of `50505`, and backed by its own `docker/data-dev/*` volumes so it never touches your
regular `docker/data/*` library. Rebuild-and-run:

```
cd docker
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Anything machine-specific (e.g. joining an external Docker network) goes in a gitignored
`docker/docker-compose.local.yml`, layered on with an extra `-f docker-compose.local.yml`.

Point the frontend dev server at it by setting `BACKEND_PORT=51200` in `frontend/.env.local` (see
`frontend/vite.config.ts`) instead of running the backend natively, then `npm run dev` as usual.
Since the image bakes in a full `npm run build` of the frontend too, this container is also a
quick way to sanity-check a production build without going through the full release flow.

To try the **desktop client mode** (the frontend talking cross-origin to a server with a bearer
token — see [`docs/FEATURES.md`](docs/FEATURES.md#desktop-app-client-mode)) in a plain browser, run
`VITE_DESKTOP=true npm run dev` and start the backend with
`CORS_ALLOWED_ORIGINS=http://localhost:5173`.

## Security and admin commands

Login failures are rate-limited (delays only, never a permanent lock) and two-factor auth (TOTP) is
optional in Settings → Account — see [`docs/FEATURES.md`](docs/FEATURES.md). Environment variables:

- `TRUSTED_PROXIES` — comma-separated IPs/CIDRs of reverse proxies whose `X-Forwarded-For` is
  believed. Default: none, so the connection's own address is used. Under Docker Desktop on
  Windows/macOS the container may see every client as one address, so per-IP limits then act like
  global ones.
- `PACKRAT_SECRET_KEY` — key that encrypts 2FA secrets. Default: an auto-generated key file
  `packrat-secret.key` next to the database (in the data volume). If it's lost, 2FA can't verify;
  `--disable-2fa` fixes that.

Two recovery commands run on the host (in Docker via `docker exec`; `-it` is required for the
password prompt). Both also sign out every session, and neither needs the 2FA key:

```
docker exec -it <container> /app/packrat --reset-password     # prompts for the new password twice
echo 'new-password' | docker exec -i <container> /app/packrat --reset-password --password-stdin
docker exec <container> /app/packrat --disable-2fa            # clears the secret and recovery codes
```

The password is never accepted as a command-line argument. Natively, run `packrat --reset-password`
(or `go run ./cmd/server --reset-password`) with the same environment as the server.

## Desktop app

[`desktop/`](desktop/README.md) is a Tauri shell around the same frontend: a desktop client that
connects to a Packrat server you already run (it bundles no backend). See its README for building it.

**Platform support:** Windows is the primary target and is tested manually against a
[checklist](desktop/TESTING.md); Linux has automated end-to-end tests in CI (and is occasionally tried
by hand); macOS builds in CI but is untested.

## Jellyfin

The Jellyfin URL (Settings → Jellyfin) must be reachable **from inside the container's network**,
not just from your browser. A bare LAN hostname (e.g. `http://mnx:8096`) that resolves fine on your
host machine often won't resolve inside the container — Docker's default bridge network doesn't
forward Windows/mDNS name resolution the way your host's own resolver does. If a rescan fails with
a `dial tcp: lookup ... no such host` error, either point the URL at your Jellyfin server's LAN IP
or a real FQDN instead of a bare hostname, or add it via `extra_hosts` in
[`docker/docker-compose.yml`](docker/docker-compose.yml) (see the commented example there).

## AI Thumbnail Enhancement

Optional, off by default (Settings → AI Enhancement). Upscales low-resolution library thumbnails
by calling a self-hosted Stable Diffusion WebUI (AUTOMATIC1111-compatible) instance's upscale-only
API — nothing is sent to any third-party service, and Packrat never bundles or runs Stable
Diffusion itself.

The same container-networking caveat as Jellyfin applies: if Packrat is running in Docker and the
Stable Diffusion instance is running directly on the host (not itself containerized), point
Settings → AI Enhancement → URL at `http://host.docker.internal:<port>` rather than
`http://127.0.0.1:<port>` or `http://localhost:<port>`, which resolve to the *container* from
inside it. `host.docker.internal` works out of the box on Docker Desktop (Windows/Mac); on Linux
hosts, add an `extra_hosts` entry to [`docker/docker-compose.yml`](docker/docker-compose.yml)
(same pattern as the commented Jellyfin example there).

### Starting Stable Diffusion from Packrat

Packrat can't run the WebUI's `.bat` from inside its container, but
[`tools/sd-launcher`](tools/sd-launcher/README.md) — a tiny standard-library Python service you run
on the Stable Diffusion machine — can. Its `setup.ps1` generates a token, makes it start at log on,
and prints the `PACKRAT_ACTION_*` lines that add **Start/Stop Stable Diffusion** to the sidebar's
**Actions** menu. See "Host actions" in [`docs/FEATURES.md`](docs/FEATURES.md) for the variables.
