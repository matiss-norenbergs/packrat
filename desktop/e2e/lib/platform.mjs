// Everything that differs per OS lives here, so the scenarios stay platform-neutral. Only Linux
// (WebKitGTK + WebKitWebDriver) is implemented; the Windows branches (WebView2 + msedgedriver,
// Run registry value) are the places to fill in when that platform gets wired up.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const here = path.dirname(fileURLToPath(import.meta.url))
export const e2eRoot = path.resolve(here, "..")
export const repoRoot = path.resolve(e2eRoot, "..", "..")

export const isLinux = process.platform === "linux"
const exe = process.platform === "win32" ? ".exe" : ""

export function assertSupported() {
  if (!isLinux) {
    throw new Error(
      `The desktop e2e suite only runs on Linux for now (this is ${process.platform}). ` +
        "See desktop/README.md → End-to-end tests (there is a Docker image for other hosts).",
    )
  }
  if (!process.env.DISPLAY) {
    throw new Error("No DISPLAY: run under Xvfb, e.g. `xvfb-run -a npm test` (see desktop/README.md).")
  }
}

/** The debug build of the desktop shell (`tauri build --debug --no-bundle`). */
export function appBinary() {
  return path.join(repoRoot, "desktop", "src-tauri", "target", "debug", `packrat-desktop${exe}`)
}

export function serverBinaryName() {
  return `packrat-server${exe}`
}

/** `tauri-driver`, from PATH or cargo's bin directory. */
export function tauriDriverBinary() {
  const name = `tauri-driver${exe}`
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".cargo", "bin")]
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    if (dir && fs.existsSync(candidate)) return candidate
  }
  throw new Error("tauri-driver not found: `cargo install tauri-driver --locked`")
}

/** Extra tauri-driver arguments naming the native driver (none needed for WebKitWebDriver on PATH). */
export function nativeDriverArgs() {
  return []
}

/** Environment that points the app at a throwaway "user" so the real machine is never touched. */
export function userEnv(home) {
  const dirs = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  return dirs
}

/** The autostart entries the app created for this fake home: `[{ file, content }]`. */
export function autostartEntries(home) {
  const dir = path.join(home, ".config", "autostart")
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".desktop"))
    .map((file) => ({ file, content: fs.readFileSync(path.join(dir, file), "utf8") }))
}

/** The app's own config directory (holds desktop.json) for this fake home. */
export function appConfigDir(home) {
  return path.join(home, ".config", "io.github.matiss-norenbergs.packrat")
}

/**
 * Whether the window titled `title` is mapped (shown) on the X display, as the window system sees
 * it — a hidden or unmapped window still answers WebDriver, so this is the real "is it visible" test.
 */
export function windowIsMapped(title) {
  const run = (...args) => execFileSync("xwininfo", args, { encoding: "utf8" })
  const tree = run("-root", "-tree")
  const ids = [...tree.matchAll(new RegExp(String.raw`^\s*(0x[0-9a-f]+) "${title}"`, "gm"))].map((m) => m[1])
  return ids.some((id) => /Map State: IsViewable/.test(run("-id", id)))
}
