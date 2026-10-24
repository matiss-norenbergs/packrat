import assert from "node:assert/strict"
import { By } from "selenium-webdriver"
import { assertCleanLog, assertNoPermissionErrors } from "../lib/assert.mjs"
import { autostartEntries } from "../lib/platform.mjs"
import { waitFor } from "../lib/proc.mjs"
import { scenario } from "../lib/scenario.mjs"
import { ADMIN } from "../lib/server.mjs"

scenario("5. Launch at login creates and removes the autostart entry", async (s) => {
  const server = await s.server()
  const app = await s.launch()
  await app.connect(server.url, "Test server")
  await app.createAdmin(ADMIN)
  await app.openSettingsDesktopTab()

  assert.deepEqual(autostartEntries(app.home), [], "nothing is registered before the switch is turned on")
  const toggle = await app.find(By.id("launch-at-login"))
  await app.driver.wait(async () => toggle.isEnabled(), 10_000)
  assert.equal(await toggle.getAttribute("aria-checked"), "false")

  await toggle.click()
  const [entry] = await waitFor(
    "the autostart entry to appear",
    () => {
      const entries = autostartEntries(app.home)
      return entries.length ? entries : null
    },
    10_000,
  )
  assert.match(entry.content, /^Exec=.*--minimized\s*$/m, `autostart entry should start with --minimized:\n${entry.content}`)
  await waitFor("the switch to turn on", async () => (await toggle.getAttribute("aria-checked")) === "true", 10_000)
  await app.find(By.id("start-minimized")) // the dependent switch appears

  await toggle.click()
  await waitFor("the autostart entry to go away", () => autostartEntries(app.home).length === 0, 10_000)
  await waitFor("the switch to turn off", async () => (await toggle.getAttribute("aria-checked")) === "false", 10_000)

  assertNoPermissionErrors(await app.record(), await app.bodyText())
  assertCleanLog(app.log())
})
