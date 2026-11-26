import { describe, expect, it } from "vitest"

// Layouts that fill the screen use the dynamic viewport (dvh): on a mobile browser 100vh is the *large* viewport, taller than
// what is visible while the URL bar is showing, so the bottom of the page (footers, the dock) sat behind it. Capped dialog
// bodies and banner proportions may keep a plain vh (see docs/architecture.md); only the full-height utilities are banned.
const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "/index.html", "!/src/**/*.test.*"], { query: "?raw", import: "default", eager: true }) as Record<string, string>

describe("screen-filling layouts use dvh", () => {
  it("has no h-screen, min-h-screen, max-h-screen or 100vh in the app source", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text.split("\n").flatMap((line, i) => (/(?<![\w-])(?:min-|max-)?h-screen\b|100vh/.test(line) ? [`${file}:${i + 1}`] : [])),
    )
    expect(offenders).toEqual([])
  })

  it.each([
    ["/src/layouts/AppLayout.tsx", "h-dvh"],
    ["/src/layouts/ImmersiveLayout.tsx", "min-h-dvh"],
    ["/src/components/sidebar/Sidebar.tsx", "h-dvh"],
    ["/src/pages/LibraryItemPage.tsx", "calc(100dvh-3.5rem)"],
    ["/src/pages/ComparePlayPage.tsx", "h-dvh"],
    ["/src/pages/LoginPage.tsx", "h-dvh"],
    ["/src/pages/ConnectPage.tsx", "h-dvh"],
  ])("%s uses %s", (file, cls) => {
    expect(sources[file]).toContain(cls)
  })
})
