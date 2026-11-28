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
  const [, major, minor, patch, pre] = m
  if (major === undefined || minor === undefined || patch === undefined) return null // unreachable: the regex requires all three
  return { core: [Number(major), Number(minor), Number(patch)], pre: pre ? pre.split(".") : [] }
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any of its pre-releases.
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const an = /^\d+$/.test(ai)
    const bn = /^\d+$/.test(bi)
    if (an && bn) {
      const d = Number(ai) - Number(bi)
      if (d) return d < 0 ? -1 : 1
    } else if (an !== bn) {
      return an ? -1 : 1 // numeric identifiers sort before alphanumeric ones
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1
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
    const xi = x.core[i] ?? 0
    const yi = y.core[i] ?? 0
    if (xi !== yi) return xi < yi ? -1 : 1
  }
  return comparePre(x.pre, y.pre) as -1 | 0 | 1
}

// True only when both are valid versions and the server is strictly newer than the app.
export function serverNewerThanApp(server: string | null | undefined, app: string | null | undefined): boolean {
  return compareSemver(server, app) === 1
}

// True only when both are valid versions and the app is strictly newer than the server.
export function appNewerThanServer(server: string | null | undefined, app: string | null | undefined): boolean {
  return compareSemver(app, server) === 1
}

// Plain "MAJOR.MINOR.PATCH" — the only shape "Match server version" will act on (no v prefix,
// pre-release or build suffix). The desktop backend re-validates this before building any URL.
export function isReleaseVersion(input: string | null | undefined): input is string {
  return /^\d+\.\d+\.\d+$/.test(input ?? "")
}
