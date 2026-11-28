// Fails when a lint-disable directive has no reason. The project rule: every
// `eslint-disable…` / `oxlint-disable…` comment carries `-- <why>` after the directive, e.g.
//   // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
// Dependency-free and fast; run with `npm run check:disables` (CI runs it too).
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DIRECTIVE = /(?:\/\/|\/\*)\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?\b(.*)$/

// Returns [{ line, text }] for every directive in `source` that has no `-- reason`.
export function findUnreasonedDisables(source) {
  const found = []
  source.split("\n").forEach((text, i) => {
    const m = DIRECTIVE.exec(text)
    if (!m) return
    const tail = m[1].replace(/\*\/\s*$/, "")
    const reason = /\s--\s+(\S.*)$/.exec(tail)
    if (!reason || !reason[1].trim()) found.push({ line: i + 1, text: text.trim() })
  })
  return found
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(p)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) yield p
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const bad = []
  for (const dir of ["src"]) {
    for (const file of sourceFiles(join(root, dir))) {
      for (const hit of findUnreasonedDisables(readFileSync(file, "utf8"))) {
        bad.push(`${file.slice(root.length)}:${hit.line}: ${hit.text}`)
      }
    }
  }
  if (bad.length) {
    console.error("Lint-disable directives without a reason (add ` -- <why>`):\n" + bad.join("\n"))
    process.exit(1)
  }
  console.log("OK: every lint-disable directive has a reason.")
}
