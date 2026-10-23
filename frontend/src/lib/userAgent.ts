// Loose, display-only parsing of a User-Agent string into "Chrome on Windows". Order matters:
// Edge/Opera/Samsung browsers also say "Chrome", Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
]

// iOS before macOS (iPad UAs say "like Mac OS X"), Android before Linux.
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux|X11/, "Linux"],
]

function firstMatch(table: [RegExp, string][], ua: string): string | null {
  for (const [re, name] of table) if (re.test(ua)) return name
  return null
}

export interface DeviceInfo {
  browser: string | null
  os: string | null
}

export function parseUserAgent(ua: string): DeviceInfo {
  return { browser: firstMatch(BROWSERS, ua), os: firstMatch(SYSTEMS, ua) }
}

// What the sessions list shows for a device: the desktop app is named as such (its embedded
// webview's "browser" is an implementation detail), a web session reads "Chrome on Windows", and
// a session recorded before this metadata existed is just an unknown device.
export function describeDevice(client: string, userAgent: string): string {
  const { browser, os } = parseUserAgent(userAgent)
  if (client === "desktop") return os ? `Packrat desktop app on ${os}` : "Packrat desktop app"
  if (browser && os) return `${browser} on ${os}`
  if (browser || os) return (browser ?? os)!
  return client === "web" ? "Web browser" : "Unknown device"
}
