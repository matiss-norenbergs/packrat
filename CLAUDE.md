# Packrat — agent guide

Self-hosted web UI wrapping `yt-dlp` + `ffmpeg` into a searchable, Jellyfin-friendly media library
(think Sonarr/Radarr for general web media). Go/Gin + SQLite (WAL) backend, React/TS/Vite/Tailwind/
shadcn frontend, shipped as one Docker image. Single admin user, session auth + CSRF.

## Read these first (in this order, only what the task needs)

- `README.md` — stack, how to run, Docker dev container, Jellyfin/AI-enhancement networking caveats.
- `docs/FEATURES.md` — page-by-page behavior. **The source of truth for "how should X work".**
- `docs/architecture.md` — backend package layout, data flow, "Deliberate scope cuts" (check before
  adding something that may have been ruled out on purpose).
- `docs/api.md` — REST/WS surface (83 KB — grep it by endpoint, don't load it whole).
- `CHANGELOG.md` — read only the top ~100 lines for recent context.
- Ignore `../docker-app-plan.md`: the original skeleton-era spec, long outdated.

## Run / verify

- Frontend (from `frontend/`): `npx tsc -b` (must be clean), `npm run test -- --run` (all pass),
  `npm run lint`, `npm run dev` (Vite, :5173, proxies `/api` to `BACKEND_PORT` in `.env.local`).
- Backend (from `backend/`): `go build ./... && go vet ./...`; `go run ./cmd/server`.
  Migrations live in `database/migrations` (numbered, applied automatically at startup).
- **Dev container** (preferred way to run the backend here):
  `cd docker && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
  → container `packrat-dev` on host port **51200**, data in `docker/data-dev/*` (gitignored).
  If `docker/docker-compose.local.yml` exists (gitignored, machine-specific — e.g. joins an external
  Docker network), add `-f docker-compose.local.yml` to the command. Never put machine-specific
  config in the committed compose files.
  `frontend/.env.local` has `BACKEND_PORT=51200`.
- **The running dev container serves whatever image it was last built from.** After ANY backend
  change, rebuild it before verifying — an un-rebuilt container returns "Settings saved" while
  silently ignoring new fields. Confirm with a changed endpoint/field or file on disk, not a toast.
- Verify UI changes in the browser (screenshot + read the DOM/computed styles), not just tsc/tests.

## Windows dev-machine quirks

- Windows Application Control blocks unsigned freshly-built binaries unpredictably, including
  `go test` binaries and `bin/server.exe`. Try `go test` once; if blocked, fall back to
  `go build` + `go vet` and a throwaway `go run` smoke program (delete it after). Still write real
  `_test.go` files — they run fine in CI.
- `backend/run-dev.cmd` is the `go run` launcher. Port 50505 can fall inside a Hyper-V reserved
  range ("bind: ... forbidden by its access permissions") — use another port + `BACKEND_PORT`.
- Ports: 50505 (release), 51200 (`packrat-dev` container).

## Conventions (follow these; they're deliberate)

**Process**
- With every feature/fix, update `docs/FEATURES.md`, `docs/api.md` (if the API changed), and add a
  bullet under the day's section in `CHANGELOG.md` (newest first; skip pure styling/spacing tweaks
  unless asked). Don't commit unless asked; when asked, match the repo's style: short subject,
  bullet body, wrapped at ~72 cols.
- Adding a setting: model const in `models/settings.go`, getter + GET/PATCH wiring in
  `api/settings_handler.go`, DTO fields in `api/dto.go`, TS type in `types/api.ts`, UI in
  `SettingsPage.tsx` (each tab uses the shared `SaveRow`).

**Frontend UI**
- Pages: `flex h-full min-h-0 flex-col gap-6`; header + toolbar are `shrink-0`; only the content
  region scrolls (`min-h-0 flex-1`, tables use `Table containerClassName="h-full overflow-auto …"`).
- Toolbar: action buttons left (primary action first, buttons carry lucide icons), filter/search on
  the right (`ml-auto`, filter before search). Bulk/destructive actions get an `AlertDialog`
  confirmation showing the count; single-item actions don't.
- Tables with selection: checkbox column + `useIdSelection` with drag/shift/ctrl-click, context menu
  where actions exist, pagination via `getPageNumbers`, 50 rows/page.
- Column alignment (global rule): date / status-tag / switch / icon columns centered, numeric
  (counts, sizes, durations, dimensions) right-aligned, everything else left. Bare SVG icons are
  `display:block` under Tailwind preflight — `text-center` won't center them; use `mx-auto`.
- Colors: never hardcode status colors — use `--success` / `--warning` / `--destructive` tokens
  (`Badge` variants `success|warning|destructive`). Never `text-white` on `bg-primary`; use
  `text-primary-foreground` (the Monochrome accent flips it per theme).
- Accents (`useAccentColor`, `[data-accent=…]` in `styles/globals.css`): Default/Blue/Red/Green/
  Yellow/Monochrome. Chart colors: `--chart-1` = `--primary`; `--chart-2..5` are per-accent sets
  from the 8-hue reference palette, validated with the dataviz skill's `validate_palette.js`
  (both light and dark). Changing an accent's primary means re-deriving and re-validating its set.
- `DialogContent` width overrides need the `sm:` prefix (`sm:max-w-2xl`) or they silently no-op.
- Client-only preferences (theme, accent, desktop notifications) live in localStorage, not Settings.

**Backend**
- yt-dlp/ffmpeg are always subprocesses, never reimplemented. Image downloads (`downloadType=image`)
  bypass yt-dlp (plain HTTP via `imagefetch`).
- Settings is a generic key/value table with in-code defaults — no migration for a new setting.
- yt-dlp cookies: Settings → yt-dlp → "Cookies file" (cookies.txt content, written next to the DB,
  passed via `--cookies`) is the one that works in Docker; "Cookies browser" cannot reach a host
  browser profile from inside the container and is ignored when a file is set.

## Current state

Work up to the "cookies file support & color fix" commit is committed. Uncommitted/untracked here:
local-only dev tooling (`backend/run-dev.cmd`, `.claude/`) and any local compose network tweaks — don't commit these.
