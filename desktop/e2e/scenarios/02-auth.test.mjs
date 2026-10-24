import assert from "node:assert/strict"
import { assertCleanLog } from "../lib/assert.mjs"
import { scenario } from "../lib/scenario.mjs"
import { ADMIN } from "../lib/server.mjs"

const tokenKeys = (ls) => Object.keys(ls).filter((k) => k.startsWith("packrat.token."))

scenario("2. connect, create the admin, log out and back in", async (s) => {
  const server = await s.server()
  let app = await s.launch()

  await app.waitForText("Connect to a server")
  await app.connect(server.url, "Test server")
  await app.createAdmin(ADMIN)
  await app.waitForText("Browse Library")

  // No Secret Service here, so the token falls back to localStorage (packrat.token.<profile id>).
  assert.equal(tokenKeys(await app.localStorage()).length, 1, "expected one stored token")

  await app.logOut()
  assert.equal(tokenKeys(await app.localStorage()).length, 0, "logging out should discard the token")
  await app.logIn(ADMIN)

  // The login survives a restart of the app (same fake home → same webview storage).
  await app.close()
  app = await s.launch({ name: "main" })
  await app.waitSignedIn()

  assertCleanLog(app.log())
})
