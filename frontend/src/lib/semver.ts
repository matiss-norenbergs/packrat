// Minimal semver handling for comparing the server's version with the desktop app's. Only
// "major.minor.patch" with an optional "v" prefix and optional -prerelease / +build suffix counts;
// anything else (e.g. the server's "dev") is not a version at all.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export interface Semver {
  core: [number, number, number]
  pre: string[]
}

export function parseSemver(input: string | null | undefined): Semver | null {
  const m = SEMVER.exec((input ?? "").trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] }
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any of its pre-releases.
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    const an = /^\d+$/.test(a[i])
    const bn = /^\d+$/.test(b[i])
    if (an && bn) {
      const d = Number(a[i]) - Number(b[i])
      if (d) return d < 0 ? -1 : 1
    } else if (an !== bn) {
      return an ? -1 : 1 // numeric identifiers sort before alphanumeric ones
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1
    }
  }
  return 0
}

// -1 / 0 / 1, or null if either side isn't a valid version.
export function compareSemver(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1
  }
  return comparePre(x.pre, y.pre) as -1 | 0 | 1
}

// True only when both are valid versions and the server is strictly newer than the app.
export function serverNewerThanApp(server: string | null | undefined, app: string | null | undefined): boolean {
  return compareSemver(server, app) === 1
}
