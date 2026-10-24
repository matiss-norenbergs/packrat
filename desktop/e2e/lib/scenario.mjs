// A scenario owns a throwaway directory, any servers/apps it starts, and (on failure) leaves
// screenshots and logs behind in artifacts/<scenario>/. Everything it started is stopped afterwards.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { App } from "./app.mjs"
import { e2eRoot } from "./platform.mjs"
import { startServer } from "./server.mjs"

const SCENARIO_TIMEOUT_MS = 150_000
const ARTIFACTS = process.env.E2E_ARTIFACTS ?? path.join(e2eRoot, "artifacts")

class Scenario {
  constructor(name) {
    this.name = name
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `packrat-e2e-${name}-`))
    this.logDir = path.join(ARTIFACTS, name)
    fs.rmSync(this.logDir, { recursive: true, force: true })
    fs.mkdirSync(this.logDir, { recursive: true })
    this.servers = []
    this.apps = []
  }

  async server(label = "a") {
    const server = await startServer({ dir: this.dir, label, logDir: this.logDir })
    this.servers.push(server)
    return server
  }

  async launch(options = {}) {
    const app = await App.launch({ dir: this.dir, logDir: this.logDir, name: options.name ?? "main", ...options })
    this.apps.push(app)
    return app
  }

  async failed(err) {
    fs.writeFileSync(path.join(this.logDir, "failure.txt"), String(err?.stack ?? err))
    // A wedged webview can hang any of these calls, so each one gets a deadline.
    const within = (promise) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 15_000))])
    for (const app of this.apps) {
      const capture = async (label, work) => {
        try {
          await within(work())
        } catch (e) {
          fs.appendFileSync(path.join(this.logDir, "failure.txt"), `
(could not capture ${label} of ${app.name}: ${e.message})
`)
        }
      }
      await capture("page record", async () =>
        fs.writeFileSync(path.join(this.logDir, `page-record-${app.name}.json`), JSON.stringify(await app.record(), null, 2)),
      )
      await capture("screenshot", () => app.screenshot(path.join(this.logDir, `failure-${app.name}.png`)))
      await capture("html", async () =>
        fs.writeFileSync(
          path.join(this.logDir, `failure-${app.name}.html`),
          await app.driver.executeScript("return document.documentElement.outerHTML"),
        ),
      )
    }
  }

  async cleanup() {
    for (const app of this.apps) await app.close()
    for (const server of this.servers) server.stop()
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

export function scenario(name, body) {
  test(name, { timeout: 240_000 }, async () => {
    const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "")
    const s = new Scenario(slug)
    // node:test's own timeout can't stop a hung body (and then skips the cleanup below), so race it.
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS / 1000}s`)), SCENARIO_TIMEOUT_MS)
    })
    try {
      await Promise.race([body(s), timeout])
    } catch (err) {
      await s.failed(err)
      throw err
    } finally {
      clearTimeout(timer)
      await s.cleanup()
    }
  })
}
