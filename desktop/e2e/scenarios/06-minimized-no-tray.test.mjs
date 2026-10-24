import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { assertCleanLog } from "../lib/assert.mjs"
import { appConfigDir, windowIsMapped } from "../lib/platform.mjs"
import { waitFor } from "../lib/proc.mjs"
import { scenario } from "../lib/scenario.mjs"

// CI (and a bare Xvfb) has no StatusNotifier host, so there is no tray to bring a hidden window
// back from. The app must then show its window even for an autostart launch with "Start minimized".
scenario("6. --minimized with Start minimized but no tray still shows the window", async (s) => {
  const app = await s.launch({
    args: ["--minimized"],
    beforeStart: (home) => {
      const dir = appConfigDir(home)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, "desktop.json"), JSON.stringify({ startMinimized: true }))
    },
  })
  await app.waitForText("Connect to a server")
  assert.ok(await app.windowVisible(), "the document should be visible")
  await waitFor("the Packrat window to be mapped on screen", () => windowIsMapped("Packrat"), 10_000)
  assertCleanLog(app.log())
})
