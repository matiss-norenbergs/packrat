// Builds the `latest.json` update manifest the desktop app's updater reads
// (https://v2.tauri.app/plugin/updater/#static-json-file). Run by the Desktop workflow after all
// platforms have built, over the directory holding their installers and signature files:
//
//   node update-manifest.mjs <dir> <version> <owner/repo>
//
// writes <dir>/latest.json. Fails loudly if any platform's update file or signature is missing,
// so a release can never ship a manifest that silently leaves a platform without updates.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// updater platform key -> how to recognise that platform's update file among the built files.
// (The macOS tarballs are renamed with an architecture by the workflow — Tauri names both
// "Packrat.app.tar.gz".)
export const PLATFORMS = {
  "windows-x86_64": (name) => name.endsWith("-setup.exe"),
  "darwin-aarch64": (name) => name.endsWith("_aarch64.app.tar.gz"),
  "darwin-x86_64": (name) => name.endsWith("_x64.app.tar.gz"),
  "linux-x86_64": (name) => name.endsWith(".AppImage"),
}

export function buildManifest({ files, readText, version, repo, pubDate = new Date().toISOString() }) {
  const tag = `v${version}`
  const platforms = {}
  const problems = []

  for (const [platform, matches] of Object.entries(PLATFORMS)) {
    const found = files.filter(matches)
    if (found.length !== 1) {
      problems.push(`${platform}: expected exactly one update file, found ${found.length} (${found.join(", ") || "none"})`)
      continue
    }
    const file = found[0]
    if (!files.includes(`${file}.sig`)) {
      problems.push(`${platform}: ${file} has no ${file}.sig`)
      continue
    }
    platforms[platform] = {
      signature: readText(`${file}.sig`).trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`,
    }
  }

  if (problems.length > 0) {
    throw new Error(`Cannot build the update manifest:\n  ${problems.join("\n  ")}`)
  }

  return {
    version,
    notes: `See the release notes: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: pubDate,
    platforms,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, version, repo] = process.argv.slice(2)
  if (!dir || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^[^/]+\/[^/]+$/.test(repo ?? "")) {
    console.error("usage: node update-manifest.mjs <dir> <MAJOR.MINOR.PATCH> <owner/repo>")
    process.exit(2)
  }
  const manifest = buildManifest({
    files: readdirSync(dir),
    readText: (name) => readFileSync(join(dir, name), "utf8"),
    version,
    repo,
  })
  writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n")
  console.log(`Wrote ${join(dir, "latest.json")} for ${Object.keys(manifest.platforms).join(", ")}`)
}
