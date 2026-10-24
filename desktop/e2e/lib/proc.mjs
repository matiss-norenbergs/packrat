import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Polls `check` until it returns a truthy value or `timeoutMs` passes. */
export async function waitFor(what, check, timeoutMs = 30_000, everyMs = 200) {
  const deadline = Date.now() + timeoutMs
  let lastError
  for (;;) {
    try {
      const value = await check()
      if (value) return value
    } catch (err) {
      lastError = err
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${lastError ? `: ${lastError.message}` : ""}`)
    }
    await sleep(everyMs)
  }
}

/**
 * Starts a child process in its own process group with stdout+stderr appended to `logFile`.
 * `stop()` kills the whole group (tauri-driver → WebKitWebDriver → the app).
 */
export function start(command, args, { logFile, env, cwd }) {
  const log = fs.openSync(logFile, "a")
  const child = spawn(command, args, { env, cwd, stdio: ["ignore", log, log], detached: true })
  let exited = false
  let closed = false
  child.once("exit", () => {
    exited = true
  })
  child.once("error", (err) => fs.appendFileSync(logFile, `\n[spawn error] ${err.message}\n`))
  return {
    child,
    get exited() {
      return exited
    },
    stop() {
      if (closed) return
      closed = true
      if (!exited) {
        try {
          process.kill(-child.pid, "SIGTERM")
        } catch {
          /* already gone */
        }
      }
      fs.closeSync(log)
    },
  }
}
