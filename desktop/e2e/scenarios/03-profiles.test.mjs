import assert from "node:assert/strict"
import { By } from "selenium-webdriver"
import { assertCleanLog } from "../lib/assert.mjs"
import { scenario } from "../lib/scenario.mjs"
import { ADMIN } from "../lib/server.mjs"

const tokenKeys = (ls) => Object.keys(ls).filter((k) => k.startsWith("packrat.token."))
const menuItem = (text) => By.xpath(`//*[@role='menuitem' and contains(normalize-space(.), '${text}')]`)

async function chooseServer(app, name) {
  await app.click(By.css('[aria-label="Switch server"]'))
  await app.click(menuItem(name))
  await app.waitSignedIn()
}

scenario("3. two servers: switch, stay signed in, rename, remove", async (s) => {
  const alpha = await s.server("alpha")
  const beta = await s.server("beta")
  const app = await s.launch()
  const profiles = () => app.driver.executeScript("return JSON.parse(localStorage.getItem('packrat.profiles') || '[]')")
  const activeUrl = async () => {
    const id = await app.driver.executeScript("return localStorage.getItem('packrat.activeProfile')")
    return (await profiles()).find((p) => p.id === id)?.url
  }

  await app.waitForText("Connect to a server")
  await app.connect(alpha.url, "Alpha")
  await app.createAdmin(ADMIN)

  // "Add server…" from the switcher, then a second, separate account on the other server.
  await app.click(By.css('[aria-label="Switch server"]'))
  await app.click(menuItem("Add server"))
  await app.waitForText("Add a server")
  await app.connect(beta.url, "Beta")
  await app.createAdmin(ADMIN)
  assert.equal(tokenKeys(await app.localStorage()).length, 2, "each server keeps its own token")

  // Switching reloads the app and comes back signed in on each.
  await chooseServer(app, "Alpha")
  assert.equal(await activeUrl(), alpha.url)
  await chooseServer(app, "Beta")
  assert.equal(await activeUrl(), beta.url)
  await chooseServer(app, "Alpha")

  // Rename Beta (Settings → Desktop → Servers).
  await app.openSettingsDesktopTab()
  await app.click(By.css('[aria-label="Edit Beta"]'))
  await app.fill(By.id("edit-server-name"), "Beta renamed")
  await app.click(app.text("Save", "button"))
  await app.find(By.css('[aria-label="Edit Beta renamed"]'))
  assert.ok((await profiles()).some((p) => p.name === "Beta renamed"))

  // Remove it: the profile and its token go, Alpha stays signed in.
  const betaId = (await profiles()).find((p) => p.name === "Beta renamed").id
  await app.click(By.css('[aria-label="Remove Beta renamed"]'))
  await app.click(app.text("Remove", "button"))
  await app.driver.wait(async () => (await profiles()).length === 1, 10_000, "the profile should be removed")
  const ls = await app.localStorage()
  assert.ok(!(`packrat.token.${betaId}` in ls), "the removed server's token should be gone")
  assert.equal(tokenKeys(ls).length, 1)
  assert.ok(await app.hasText("Log out"), "Alpha should still be signed in")

  // Removing the active (last) server leaves the Connect screen.
  await app.click(By.css('[aria-label="Remove Alpha"]'))
  await app.click(app.text("Remove", "button"))
  await app.waitForText("Connect to a server")
  assert.equal(tokenKeys(await app.localStorage()).length, 0)

  assertCleanLog(app.log())
})
