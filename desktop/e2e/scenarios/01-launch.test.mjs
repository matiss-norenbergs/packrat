import assert from "node:assert/strict"
import { assertCleanLog } from "../lib/assert.mjs"
import { scenario } from "../lib/scenario.mjs"

scenario("1. launch shows the Connect to a server screen", async (s) => {
  const app = await s.launch()
  await app.waitForText("Connect to a server")
  assert.equal(await app.driver.getTitle(), "Packrat")

  const record = await app.record()
  assert.deepEqual(record.errors, [], "the page logged errors")
  assert.deepEqual(
    record.invokes.filter((i) => !i.ok),
    [],
    "a Tauri command failed on startup",
  )
  assertCleanLog(app.log())
})
