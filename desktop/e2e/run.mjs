// Entry point (`npm test`): builds the Go server and the debug desktop app, then runs the scenarios
// one after another. Extra arguments go to `node --test`, e.g. `npm test -- --test-name-pattern=autostart`.
// E2E_SKIP_BUILD=1 reuses the binaries from the previous run.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { appBinary, assertSupported, e2eRoot, repoRoot, serverBinaryName } from "./lib/platform.mjs"

function step(title, command, args, cwd) {
  console.log(`\n▶ ${title}`)
  const started = Date.now()
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (result.status !== 0) {
    console.error(`✖ ${title} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
  console.log(`✔ ${title} (${Math.round((Date.now() - started) / 1000)}s)`)
}

try {
  assertSupported()
} catch (err) {
  console.error(err.message)
  process.exit(2)
}

const buildDir = path.join(e2eRoot, ".build")
fs.mkdirSync(buildDir, { recursive: true })
const serverBin = path.join(buildDir, serverBinaryName())

if (process.env.E2E_SKIP_BUILD !== "1") {
  step("Build the Packrat server", "go", ["build", "-o", serverBin, "./cmd/server"], path.join(repoRoot, "backend"))
  // `tauri build --debug --no-bundle` embeds the frontend build (a plain `cargo build` would load the
  // dev server URL instead) and keeps the debug-only update-endpoint override.
  step("Build the desktop app (debug)", "npm", ["run", "build", "--", "--debug", "--no-bundle"], path.join(repoRoot, "desktop"))
}
for (const file of [serverBin, appBinary()]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file} — run without E2E_SKIP_BUILD.`)
    process.exit(2)
  }
}

const scenarios = fs
  .readdirSync(path.join(e2eRoot, "scenarios"))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => path.join("scenarios", f))

console.log("\n▶ Run the scenarios")
const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-force-exit", ...process.argv.slice(2), ...scenarios], {
  cwd: e2eRoot,
  stdio: "inherit",
  env: { ...process.env, E2E_SERVER_BIN: serverBin },
})
process.exit(run.status ?? 1)
