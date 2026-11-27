import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { analyzeDist } from "./check-bundle.mjs"

const dirs = []
// Builds a fake dist: `chunks` maps file name -> source; index.html references `entry` and `preloads`.
function fakeDist(chunks, { entry = "index-AAAAAAAA.js", preloads = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"))
  dirs.push(dir)
  fs.mkdirSync(path.join(dir, "assets"))
  for (const [name, code] of Object.entries(chunks)) fs.writeFileSync(path.join(dir, "assets", name), code)
  const links = preloads.map((p) => `<link rel="modulepreload" crossorigin href="/assets/${p}">`).join("")
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<html><head><script type="module" crossorigin src="/assets/${entry}"></script>${links}<link rel="stylesheet" href="/assets/index-AAAAAAAA.css"></head></html>`,
  )
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("check-bundle", () => {
  it("passes when on-demand chunks are only reached dynamically", () => {
    const dir = fakeDist(
      {
        "index-AAAAAAAA.js": 'import{t as e}from"./vendor-react-BBBBBBBB.js";import"./vendor-CCCCCCCC.js";const p=()=>import("./vendor-charts-DDDDDDDD.js");',
        "vendor-react-BBBBBBBB.js": "export const t=1;",
        "vendor-CCCCCCCC.js": "export const x=1;",
        "vendor-charts-DDDDDDDD.js": "export const c=1;",
      },
      { preloads: ["vendor-react-BBBBBBBB.js", "vendor-CCCCCCCC.js"] },
    )
    const { files, violations, total } = analyzeDist(dir)
    expect(violations).toEqual([])
    expect(files.map((f) => f.file).sort()).toEqual(["assets/index-AAAAAAAA.js", "assets/vendor-CCCCCCCC.js", "assets/vendor-react-BBBBBBBB.js"])
    expect(total.raw).toBeGreaterThan(0)
    expect(total.gzip).toBeGreaterThan(0)
  })

  it("fails when index.html preloads a denylisted chunk", () => {
    const dir = fakeDist(
      { "index-AAAAAAAA.js": "export{};", "vendor-charts-DDDDDDDD.js": "export const c=1;" },
      { preloads: ["vendor-charts-DDDDDDDD.js"] },
    )
    const { violations } = analyzeDist(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/vendor-charts-DDDDDDDD\.js.*index\.html.*Dashboard/)
  })

  it("fails when a startup chunk statically imports a denylisted chunk (hash-independent)", () => {
    const dir = fakeDist(
      {
        "index-AAAAAAAA.js": 'import"./vendor-react-BBBBBBBB.js";',
        "vendor-react-BBBBBBBB.js": 'import{a}from"./vendor-calendar-EEEEEEEE.js";export const t=a;',
        "vendor-calendar-EEEEEEEE.js": "export const a=1;",
      },
      { preloads: ["vendor-react-BBBBBBBB.js"] },
    )
    const { violations } = analyzeDist(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/vendor-calendar-EEEEEEEE\.js.*vendor-react-BBBBBBBB\.js/)
  })

  it("fails when the windowed-grid library lands on the startup path", () => {
    const dir = fakeDist(
      { "index-AAAAAAAA.js": 'import"./vendor-virtual-FFFFFFFF.js";', "vendor-virtual-FFFFFFFF.js": "export const v=1;" },
      { preloads: [] },
    )
    const { violations } = analyzeDist(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/vendor-virtual-FFFFFFFF\.js.*Library/)
  })

  it("does not confuse the catch-all vendor chunk with vendor-* groups", () => {
    const dir = fakeDist({ "index-AAAAAAAA.js": 'import"./vendor-CCCCCCCC.js";', "vendor-CCCCCCCC.js": "export{};" })
    expect(analyzeDist(dir).violations).toEqual([])
  })
})
