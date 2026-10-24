import assert from "node:assert/strict"
import { By } from "selenium-webdriver"
import { assertCleanLog, assertNoPermissionErrors } from "../lib/assert.mjs"
import { autostartEntries } from "../lib/platform.mjs"
import { waitFor } from "../lib/proc.mjs"
import { scenario } from "../lib/scenario.mjs"
import { ADMIN } from "../lib/server.mjs"

scenario("5. The Startup select creates and removes the autostart entry", async (s) => {
  const server = await s.server()
  const app = await s.launch()
  await app.connect(server.url, "Test server")
  await app.createAdmin(ADMIN)
  await app.openSettingsDesktopTab()

  assert.deepEqual(autostartEntries(app.home), [], "nothing is registered before a startup option is chosen")
  const select = await app.find(By.id("startup"))
  await app.driver.wait(async () => select.isEnabled(), 10_000)
  assert.equal(await select.getText(), "Don't start at login")

  // Radix renders the options in a portal, so pick them by role and exact text.
  const choose = async (label) => {
    await app.click(By.id("startup"))
    await app.click(By.xpath(`//*[@role='option' and normalize-space(.)=${JSON.stringify(label)}]`))
    await waitFor(`the select to show "${label}"`, async () => (await select.getText()) === label, 10_000)
  }
  const startMinimized = async () => (await app.invoke("get_start_minimized")).value

  await choose("Start at login")
  const [entry] = await waitFor(
    "the autostart entry to appear",
    () => {
      const entries = autostartEntries(app.home)
      return entries.length ? entries : null
    },
    10_000,
  )
  assert.match(entry.content, /^Exec=.*--minimized\s*$/m, `autostart entry should start with --minimized:
${entry.content}`)
  assert.equal(await startMinimized(), false, "'Start at login' shows the window")

  await choose("Start at login, hidden in the tray")
  assert.equal(autostartEntries(app.home).length, 1, "the entry stays when the window is to be hidden")
  assert.equal(await startMinimized(), true, "'hidden in the tray' sets the shell pref")

  await choose("Don't start at login")
  await waitFor("the autostart entry to go away", () => autostartEntries(app.home).length === 0, 10_000)

  assertNoPermissionErrors(await app.record(), await app.bodyText())
  assertCleanLog(app.log())
})
