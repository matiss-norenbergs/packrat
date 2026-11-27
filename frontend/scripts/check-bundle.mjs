#!/usr/bin/env node
// Guards the startup path of the production build (see "Frontend bundle is split per route" in
// docs/architecture.md). Reads dist/index.html, follows every chunk it references through *static*
// imports, and fails if one of those is a chunk that must only load on demand (matched by the
// chunk-name prefix `vite.config.ts` gives its group, so hash changes don't matter). Prints the
// startup total so the CI log shows the trend; there is deliberately no size budget.
//
//   node scripts/check-bundle.mjs [distDir]      (default: dist)
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

// Chunk-name prefix -> why it must stay off the startup path. Keep in sync with the groups in vite.config.ts.
export const DENYLIST = {
  "vendor-charts": "recharts/d3 are used only by the Dashboard",
  "vendor-dnd": "@dnd-kit is used only by the Edit Sequence dialog",
  "vendor-panels": "react-resizable-panels is used only by the Edit Sequence dialog",
  "vendor-calendar": "react-day-picker/date-fns are used only by the Artist dialog, Artists and Dashboard pages",
  "vendor-qr": "qrcode.react is used only by the 2FA setup card",
  "vendor-virtual": "@tanstack/react-virtual is used only by the Library's windowed grid",
  "vendor-tauri": "the Tauri plugins are imported dynamically, only inside the desktop shell",
}

const chunkName = (file) => path.basename(file).replace(/-[\w-]{8}\.(m?js)$/, "")

// Static imports of a built chunk ("./x.js"). Dynamic `import("./x.js")` has a "(" so it never matches.
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{},\s]*?from\s*)?["'](\.\/[^"']+\.m?js)["']/g

export function analyzeDist(distDir) {
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8")
  const roots = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="\/?(assets\/[^"]+\.m?js)"/g)].map((m) => m[1])
  if (roots.length === 0) throw new Error(`no script/modulepreload entries found in ${path.join(distDir, "index.html")}`)

  const via = new Map(roots.map((r) => [r, "index.html"])) // file -> what pulled it in
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.shift()
    const code = fs.readFileSync(path.join(distDir, file), "utf8")
    for (const m of code.matchAll(STATIC_IMPORT)) {
      const dep = path.posix.join(path.posix.dirname(file), m[1])
      if (!via.has(dep)) {
        via.set(dep, path.basename(file))
        queue.push(dep)
      }
    }
  }

  const files = [...via.keys()].map((file) => {
    const buf = fs.readFileSync(path.join(distDir, file))
    return { file, via: via.get(file), raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length }
  })
  const violations = files.flatMap((f) => {
    const prefix = Object.keys(DENYLIST).find((p) => chunkName(f.file) === p)
    return prefix ? [`${f.file} is on the startup path (pulled in by ${f.via}): ${DENYLIST[prefix]}`] : []
  })
  const total = files.reduce((t, f) => ({ raw: t.raw + f.raw, gzip: t.gzip + f.gzip }), { raw: 0, gzip: 0 })
  return { files, violations, total }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

function main() {
  const dist = path.resolve(process.argv[2] ?? "dist")
  const { files, violations, total } = analyzeDist(dist)
  console.log(`Startup JS (index.html + static imports) in ${dist}:`)
  for (const f of files) console.log(`  ${f.file.padEnd(48)} ${kb(f.raw).padStart(10)} raw ${kb(f.gzip).padStart(10)} gzip`)
  console.log(`  ${"total".padEnd(48)} ${kb(total.raw).padStart(10)} raw ${kb(total.gzip).padStart(10)} gzip`)
  if (violations.length > 0) {
    for (const v of violations) console.error(`FAIL: ${v}`)
    process.exit(1)
  }
  console.log("OK: no on-demand chunk is on the startup path.")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
