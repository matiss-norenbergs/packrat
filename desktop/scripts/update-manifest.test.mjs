import assert from "node:assert/strict"
import { test } from "node:test"
import { buildManifest } from "./update-manifest.mjs"

const FILES = [
  "Packrat_1.2.3_x64-setup.exe",
  "Packrat_1.2.3_x64-setup.exe.sig",
  "Packrat_1.2.3_x64_en-US.msi",
  "Packrat_1.2.3_x64_en-US.msi.sig",
  "Packrat_1.2.3_aarch64.app.tar.gz",
  "Packrat_1.2.3_aarch64.app.tar.gz.sig",
  "Packrat_1.2.3_x64.app.tar.gz",
  "Packrat_1.2.3_x64.app.tar.gz.sig",
  "Packrat_1.2.3_aarch64.dmg",
  "Packrat_1.2.3_x64.dmg",
  "Packrat_1.2.3_amd64.AppImage",
  "Packrat_1.2.3_amd64.AppImage.sig",
  "Packrat_1.2.3_amd64.deb",
]
const readText = (name) => `signature-of-${name}\n`
const base = { readText, version: "1.2.3", repo: "me/packrat", pubDate: "2026-10-22T00:00:00.000Z" }

test("builds a manifest covering every platform", () => {
  const m = buildManifest({ ...base, files: FILES })
  assert.equal(m.version, "1.2.3")
  assert.deepEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"])
  assert.equal(
    m.platforms["windows-x86_64"].url,
    "https://github.com/me/packrat/releases/download/v1.2.3/Packrat_1.2.3_x64-setup.exe",
  )
  assert.equal(m.platforms["windows-x86_64"].signature, "signature-of-Packrat_1.2.3_x64-setup.exe.sig")
  assert.equal(m.platforms["darwin-aarch64"].url.endsWith("Packrat_1.2.3_aarch64.app.tar.gz"), true)
  assert.equal(m.platforms["darwin-x86_64"].url.endsWith("Packrat_1.2.3_x64.app.tar.gz"), true)
  assert.equal(m.platforms["linux-x86_64"].url.endsWith("Packrat_1.2.3_amd64.AppImage"), true)
  assert.match(m.notes, /releases\/tag\/v1\.2\.3$/)
})

test("fails when a platform's update file is missing", () => {
  const files = FILES.filter((f) => !f.includes("aarch64.app.tar.gz"))
  assert.throws(() => buildManifest({ ...base, files }), /darwin-aarch64: expected exactly one update file, found 0/)
})

test("fails when a signature is missing", () => {
  const files = FILES.filter((f) => f !== "Packrat_1.2.3_amd64.AppImage.sig")
  assert.throws(() => buildManifest({ ...base, files }), /linux-x86_64: .*has no .*\.sig/)
})

test("fails when a platform matches more than one file", () => {
  const files = [...FILES, "Packrat_9_x64-setup.exe"]
  assert.throws(() => buildManifest({ ...base, files }), /windows-x86_64: expected exactly one.*found 2/)
})

test("reports every problem at once", () => {
  assert.throws(() => buildManifest({ ...base, files: [] }), (err) => {
    return ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"].every((p) => err.message.includes(p))
  })
})
