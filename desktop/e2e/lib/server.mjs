// A real Packrat server (the Go binary built from this repo) on a free port with its own empty
// database and data directories.

import fs from "node:fs"
import path from "node:path"
import { repoRoot } from "./platform.mjs"
import { freePort, start, waitFor } from "./proc.mjs"

export const ADMIN = { username: "admin", password: "E2e-Passw0rd-123" }

// The origins the Tauri webview loads the UI from (Linux/macOS, then Windows).
const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]

export async function startServer({ dir, label, logDir }) {
  const bin = process.env.E2E_SERVER_BIN
  if (!bin) throw new Error("E2E_SERVER_BIN is not set (run through `npm test`, which builds the server)")
  const port = await freePort()
  const data = path.join(dir, `server-${label}`)
  fs.mkdirSync(data, { recursive: true })
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(data, "db", "packrat.db"),
    MEDIA_ROOT: path.join(data, "media"),
    IMAGES_ROOT: path.join(data, "images"),
    BACKUPS_ROOT: path.join(data, "backups"),
    CACHE_ROOT: path.join(data, "cache"),
    MIGRATIONS_DIR: path.join(repoRoot, "database", "migrations"),
    CORS_ALLOWED_ORIGINS: TAURI_ORIGINS.join(","),
  }
  const proc = start(bin, [], {
    logFile: path.join(logDir, `server-${label}.log`),
    env,
    cwd: path.join(repoRoot, "backend"),
  })
  const url = `http://127.0.0.1:${port}`
  await waitFor(
    `server ${label} to answer ${url}/api/health`,
    async () => {
      if (proc.exited) throw new Error("the server process exited (see server log)")
      return (await fetch(`${url}/api/health`)).ok
    },
    30_000,
  )
  return { url, port, stop: () => proc.stop() }
}
