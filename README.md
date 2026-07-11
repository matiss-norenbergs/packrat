# Packrat

Self-hosted web app that wraps `yt-dlp` and `ffmpeg` behind a modern UI, turning media downloads
into a searchable, Jellyfin-friendly library — inspired by Sonarr/Radarr, but for general web
media instead of TV/movies.

> Only download content you have the right to download.

## Status

This is a **working skeleton**, not the full feature set described in
[`docker-app-plan.md`](../docker-app-plan.md). One real flow is implemented end to end: submit a
URL, `yt-dlp` fetches metadata, the download runs as a subprocess with live progress over
WebSocket, and the completed file lands in the Library. See
[`docs/FEATURES.md`](docs/FEATURES.md) for a page-by-page guide to everything that's implemented,
and [`docs/architecture.md`](docs/architecture.md) for what is and is not built yet under the hood.

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
