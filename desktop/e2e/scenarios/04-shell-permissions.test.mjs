import assert from "node:assert/strict"
import { By } from "selenium-webdriver"
import { assertCleanLog, assertNoPermissionErrors, PERMISSION_ERROR } from "../lib/assert.mjs"
import { startMockRelease } from "../lib/mockrelease.mjs"
import { sleep } from "../lib/proc.mjs"
import { scenario } from "../lib/scenario.mjs"
import { ADMIN } from "../lib/server.mjs"

// The capability/ACL regression check: Settings → Desktop exercises the plugin commands the webview
// is granted (app version, updater, …) and every custom shell command is called once.
scenario("4. Settings → Desktop works without permission errors; every shell command answers", async (s) => {
  const server = await s.server()
  const release = await startMockRelease({ "0.0.1": "9.9.9", "9.9.9": "9.9.9" })
  try {
    const app = await s.launch({ env: { PACKRAT_UPDATE_BASE_URL: release.baseUrl } })
    await app.waitForText("Connect to a server")
    await app.connect(server.url, "Test server")
    await app.createAdmin(ADMIN)
    await app.openSettingsDesktopTab()

    // The sections render with their data loaded: the switches are enabled only after the
    // `is_enabled` / `get_*` calls resolved.
    for (const text of ["Downloads", "Startup", "Updates", "Close to tray", "Save to"]) {
      await app.waitForText(text)
    }
    await app.waitForText("Token storage: Local file (keychain unavailable)")
    // core:app:default → getVersion
    await app.driver.wait(async () => /App \d+\.\d+/.test(await app.bodyText()), 20_000, "the app version should show")
    for (const id of ["close-to-tray", "startup", "ask-where-to-save"]) {
      const el = await app.find(By.id(id))
      const enabled = await app.driver.wait(async () => el.isEnabled(), 10_000).then(() => true, () => false)
      if (!enabled) {
        const refused = (await app.record()).invokes.filter((i) => !i.ok)
        assert.fail(`#${id} never became enabled (its state did not load). Failed commands: ${JSON.stringify(refused)}`)
      }
    }

    // Updater: pressed for real. The outcome depends on the network and releases, but it must not
    // be a permission error.
    await app.click(app.text("Check for updates", "button"))
    await app.driver.wait(
      async () => /You're up to date|is available|Couldn't check for updates/.test(await app.bodyText()),
      30_000,
      "the update check should finish",
    )

    const record = await app.record()
    assertNoPermissionErrors(record, await app.bodyText())
    for (const cmd of ["get_close_to_tray", "get_download_folder", "autostart_is_enabled"]) {
      assert.ok(record.invokes.some((i) => i.cmd === cmd && i.ok), `the page should have called ${cmd} successfully`)
    }

    // --- every custom shell command, once -------------------------------------------------------
    const ok = async (cmd, args) => {
      const r = await app.invoke(cmd, args)
      assert.ok(r.ok, `${cmd} failed: ${r.error}`)
      return r.value
    }
    for (const [get, set] of [
      ["get_close_to_tray", "set_close_to_tray"],
      ["get_start_minimized", "set_start_minimized"],
      ["get_ask_where_to_save", "set_ask_where_to_save"],
    ]) {
      const before = await ok(get)
      await ok(set, { enabled: !before })
      assert.equal(await ok(get), !before, `${set} should change what ${get} reports`)
      await ok(set, { enabled: before })
    }

    // tray_set_servers rebuilds the tray menu; clicks on it can't be driven in CI. A bad id is
    // dropped, not an error.
    await ok("tray_set_servers", { servers: [{ id: "a1", name: "A" }, { id: "bad id", name: "B" }], activeId: "a1" })
    await ok("tray_set_servers", { servers: [], activeId: null })

    const folder = await ok("get_download_folder")
    assert.equal(typeof folder.path, "string")
    assert.equal((await ok("reset_download_folder")).isDefault, true)

    // choose_download_folder opens a native dialog that can't be driven here: starting it and
    // seeing the call neither fail nor return is enough to show it is allowed and runs.
    await app.driver.executeScript(
      `window.__chooser = null;
       window.__TAURI_INTERNALS__.invoke("choose_download_folder").then(
         (v) => { window.__chooser = { ok: true, value: v } },
         (e) => { window.__chooser = { ok: false, error: String((e && e.message) || e) } })`,
    )
    await sleep(1500)
    const chooser = await app.driver.executeScript("return window.__chooser")
    assert.ok(chooser === null || chooser.ok || !PERMISSION_ERROR.test(chooser.error), `choose_download_folder: ${chooser?.error}`)

    assert.equal(await ok("token_store_kind"), "local")
    // The keychain is unreachable in this environment, so these may report an error — what matters
    // is that it is the command's own error and not a permission one. A bad id is refused up front.
    for (const [cmd, args] of [
      ["token_get", { id: "e2e_probe" }],
      ["token_set", { id: "e2e_probe", token: "x" }],
      ["token_clear", { id: "e2e_probe" }],
      ["token_adopt_legacy", { id: "e2e_probe" }],
    ]) {
      const r = await app.invoke(cmd, args)
      assert.ok(r.ok || !PERMISSION_ERROR.test(r.error), `${cmd}: ${r.error}`)
      const bad = await app.invoke(cmd, { ...args, id: "not a valid id!" })
      assert.deepEqual(bad, { ok: false, error: "invalid profile id" }, `${cmd} should reject a bad profile id itself`)
    }

    // Match server version: a request the mock answers with another release is refused…
    const refused = await app.invoke("match_update_check", { version: "0.0.1" })
    assert.equal(refused.ok, false)
    assert.match(refused.error, /refusing to install/)
    // …a plain non-version never reaches the network…
    const junk = await app.invoke("match_update_check", { version: "dev" })
    assert.equal(junk.ok, false)
    assert.match(junk.error, /not a release version/)
    // …the matching release is found, and installing it stops at the signature check.
    const found = await ok("match_update_check", { version: "9.9.9" })
    assert.equal(found.version, "9.9.9")
    const install = await app.invoke("match_update_install")
    assert.equal(install.ok, false)
    assert.doesNotMatch(install.error, PERMISSION_ERROR)
    assert.notEqual(install.error, "No update has been checked")
    assert.deepEqual(await app.invoke("match_update_install"), { ok: false, error: "No update has been checked" })

    assertNoPermissionErrors(await app.record(), await app.bodyText())
    assertCleanLog(app.log())
  } finally {
    release.stop()
  }
})
