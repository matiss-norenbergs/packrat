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
and session auth with CSRF protection are all implemented. See [`docs/FEATURES.md`](docs/FEATURES.md)
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

## Jellyfin

The Jellyfin URL (Settings → Jellyfin) must be reachable **from inside the container's network**,
not just from your browser. A bare LAN hostname (e.g. `http://mnx:8096`) that resolves fine on your
host machine often won't resolve inside the container — Docker's default bridge network doesn't
forward Windows/mDNS name resolution the way your host's own resolver does. If a rescan fails with
a `dial tcp: lookup ... no such host` error, either point the URL at your Jellyfin server's LAN IP
or a real FQDN instead of a bare hostname, or add it via `extra_hosts` in
[`docker/docker-compose.yml`](docker/docker-compose.yml) (see the commented example there).
