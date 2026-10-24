// Launches the desktop shell through tauri-driver and wraps the Selenium session with the few
// helpers the scenarios need.

import fs from "node:fs"
import path from "node:path"
import { Builder, By, until } from "selenium-webdriver"
import { appBinary, nativeDriverArgs, tauriDriverBinary, userEnv } from "./platform.mjs"
import { freePort, sleep, start, waitFor } from "./proc.mjs"

// Installed into the page after every load (Selenium has no console log for WebKitGTK). It records
// uncaught errors, console.error output and every Tauri command with its outcome — a command the
// capability file doesn't allow shows up as a failed call. The record survives reloads
// (sessionStorage) so a scenario can inspect it after switching servers.
const HOOK = String.raw`
  if (window.__e2e) return;
  const KEY = "__e2e_log";
  let log = { errors: [], invokes: [] };
  try { log = JSON.parse(sessionStorage.getItem(KEY)) || log } catch {}
  window.__e2e = log;
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(log)) } catch {} };
  const text = (v) => (v && v.message) || String(v);
  window.addEventListener("error", (e) => { log.errors.push("error: " + e.message); save() });
  window.addEventListener("unhandledrejection", (e) => { log.errors.push("unhandledrejection: " + text(e.reason)); save() });
  const original = console.error;
  console.error = (...args) => { log.errors.push("console.error: " + args.map(text).join(" ")); save(); original.apply(console, args) };
  // invoke itself is read-only, so watch the transport: every command is a fetch to the ipc
  // scheme (ipc://localhost/<command> on Linux/macOS, http://ipc.localhost/<command> on Windows),
  // answered with a Tauri-Response header of ok or error (and the error text as the body) — a command the
  // capability file doesn't allow comes back as an error too.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const m = /^(?:ipc:\/\/localhost|https?:\/\/ipc\.localhost)\/([^?#]+)/.exec(url);
    const response = await nativeFetch(input, init);
    if (m) {
      const cmd = decodeURIComponent(m[1]);
      if (response.headers.get("Tauri-Response") === "ok") log.invokes.push({ cmd, ok: true });
      else log.invokes.push({ cmd, ok: false, error: await response.clone().text().catch(() => "") });
      save();
    }
    return response;
  };
`

export class App {
  constructor({ driver, driverProc, home, logDir, name }) {
    this.driver = driver
    this.driverProc = driverProc
    this.home = home
    this.logDir = logDir
    this.name = name
  }

  static async launch({ dir, logDir, name, args = [], env = {}, beforeStart }) {
    const home = path.join(dir, `home-${name}`)
    const user = userEnv(home)
    beforeStart?.(home)
    const appEnv = {
      ...process.env,
      ...user,
      // No session bus: the tray has nothing to show in and the keychain is unreachable — exactly
      // like CI. (An address that goes nowhere also stops libdbus from auto-launching a bus.)
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/packrat-e2e-bus",
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      WEBKIT_DISABLE_DMABUF_RENDERER: "1",
      RUST_BACKTRACE: "1",
      ...env,
    }
    const port = await freePort()
    const nativePort = await freePort()
    const driverProc = start(
      tauriDriverBinary(),
      ["--port", String(port), "--native-port", String(nativePort), ...nativeDriverArgs()],
      { logFile: path.join(logDir, `app-${name}.log`), env: appEnv },
    )
    await waitFor("tauri-driver to listen", async () => {
      if (driverProc.exited) throw new Error("tauri-driver exited (see app log)")
      const res = await fetch(`http://127.0.0.1:${port}/status`).catch(() => null)
      return res?.ok
    })
    const driver = await new Builder()
      .usingServer(`http://127.0.0.1:${port}/`)
      .withCapabilities({
        browserName: "wry",
        "tauri:options": { application: appBinary(), args },
      })
      .build()
    const app = new App({ driver, driverProc, home, logDir, name })
    await app.ready()
    return app
  }

  /** Waits for the React app to have rendered something and (re)installs the page hooks. */
  async ready() {
    await waitFor("the app to render", async () => {
      const state = await this.driver.executeScript(
        "return document.readyState === 'complete' && !!document.getElementById('root') && document.getElementById('root').childElementCount > 0",
      )
      return state
    }, 30_000)
    await this.installHooks()
  }

  async installHooks() {
    await this.driver.executeScript(`(function(){${HOOK}})()`)
  }

  /** What the page recorded: `{ errors: string[], invokes: {cmd, ok, error?}[] }`. */
  async record() {
    await this.installHooks()
    return this.driver.executeScript("return JSON.parse(JSON.stringify(window.__e2e))")
  }

  /** The app's stdout/stderr (via tauri-driver). */
  log() {
    const file = path.join(this.logDir, `app-${this.name}.log`)
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  }

  // --- UI helpers -------------------------------------------------------------------------------

  async find(locator, timeoutMs = 20_000) {
    const el = await this.driver.wait(until.elementLocated(locator), timeoutMs, `element ${locator}`)
    return el
  }

  /** An element by its visible text (exact, whitespace-normalized), optionally of a given tag. */
  text(text, tag = "*") {
    return By.xpath(`//${tag}[normalize-space(.)=${xpathString(text)}]`)
  }

  containsText(text, tag = "*") {
    return By.xpath(`//${tag}[contains(normalize-space(.), ${xpathString(text)})]`)
  }

  async click(locator, timeoutMs) {
    const el = await this.find(locator, timeoutMs)
    await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center', inline: 'center' })", el)
    await this.driver.wait(until.elementIsVisible(el), 10_000)
    await this.driver.wait(until.elementIsEnabled(el), 10_000)
    await el.click()
    return el
  }

  async fill(locator, value) {
    const el = await this.find(locator)
    await el.clear()
    await el.sendKeys(value)
  }

  async waitForText(text, timeoutMs = 20_000) {
    return this.find(this.containsText(text), timeoutMs)
  }

  async hasText(text) {
    return (await this.driver.findElements(this.containsText(text))).length > 0
  }

  async bodyText() {
    return this.driver.executeScript("return document.body.innerText")
  }

  /** Runs a Tauri command from the page and reports `{ ok, value | error }` instead of throwing. */
  async invoke(cmd, args = {}) {
    return this.driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
         (value) => done({ ok: true, value }),
         (err) => done({ ok: false, error: (err && err.message) || String(err) }));`,
      cmd,
      args,
    )
  }

  async localStorage() {
    return this.driver.executeScript(
      "return Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))",
    )
  }

  // --- flows ------------------------------------------------------------------------------------

  /** Connect screen → server address (+ optional name) → Connect. The page reloads afterwards. */
  async connect(url, name) {
    await this.fill(By.id("server-url"), url)
    if (name) await this.fill(By.id("server-name"), name)
    await this.click(this.text("Connect", "button"))
    await this.find(By.id("username"), 30_000)
    await this.ready()
  }

  /** First-run "Create admin account" form. Lands on the signed-in app. */
  async createAdmin({ username, password }) {
    await this.waitForText("Create admin account")
    await this.fill(By.id("username"), username)
    await this.fill(By.id("password"), password)
    await this.fill(By.id("confirm-password"), password)
    await this.click(this.text("Create account", "button"))
    await this.waitSignedIn()
  }

  async logIn({ username, password }) {
    await this.waitForText("Log in")
    await this.fill(By.id("username"), username)
    await this.fill(By.id("password"), password)
    await this.click(this.text("Log in", "button"))
    await this.waitSignedIn()
  }

  async waitSignedIn() {
    await this.find(this.text("Log out", "button"), 30_000)
    await this.ready()
  }

  async logOut() {
    await this.click(this.text("Log out", "button"))
    await this.find(By.id("username"), 30_000)
    await this.ready()
  }

  async openSettingsDesktopTab() {
    // The server switcher's "Manage servers" goes straight to this tab (the tab strip itself
    // scrolls sideways, which WebDriver can't click reliably).
    await this.click(By.css('[aria-label="Switch server"]'))
    await this.click(By.xpath("//*[@role='menuitem' and contains(normalize-space(.), 'Manage servers')]"))
    await this.waitForText("Startup")
    await this.installHooks()
  }

  async windowVisible() {
    // Hidden windows still answer WebDriver; the document's own view of itself is what a user
    // would notice. visibilityState is "hidden" for an unmapped/hidden window.
    return this.driver.executeScript("return document.visibilityState === 'visible'")
  }

  async screenshot(file) {
    const png = await this.driver.takeScreenshot()
    fs.writeFileSync(file, png, "base64")
  }

  async close() {
    try {
      await Promise.race([this.driver.quit(), sleep(10_000)])
    } catch {
      /* the session may already be gone */
    }
    this.driverProc.stop()
  }
}

function xpathString(s) {
  if (!s.includes("'")) return `'${s}'`
  return `concat(${s.split("'").map((p) => `'${p}'`).join(`, "'", `)})`
}
