import { describe, expect, it } from "vitest"
import { barPaint, parsePlayerFx, type PlayerFx } from "./playerFx"
import { PLAYER_BAR_OPACITY_FULLSCREEN, PLAYER_BAR_OPACITY_SOLID } from "./playerTheme"

const set = (...f: PlayerFx[]) => new Set<PlayerFx>(f)

describe("parsePlayerFx", () => {
  it("is empty without the parameter or with an empty value", () => {
    expect([...parsePlayerFx("")]).toEqual([])
    expect([...parsePlayerFx("?playerDebug=1")]).toEqual([])
    expect([...parsePlayerFx("?playerFx=")]).toEqual([])
  })
  it("reads one flag and several", () => {
    expect([...parsePlayerFx("?playerFx=layer")]).toEqual(["layer"])
    expect([...parsePlayerFx("?playerDebug=1&playerFx=layer,noanim,solid")].sort()).toEqual(["layer", "noanim", "solid"])
  })
  it("ignores unknown flags, whitespace and case", () => {
    expect([...parsePlayerFx("?playerFx=%20layer%20,%20bogus,,NoAnim")].sort()).toEqual(["layer", "noanim"])
  })
})

describe("barPaint", () => {
  const base = { overlay: true, visible: true }
  const blurred = (s: ReturnType<typeof barPaint>) => "backdropFilter" in s.style

  it("is glass outside fullscreen", () => {
    const p = barPaint({ ...base, fullscreen: false, fx: set() })
    expect(blurred(p)).toBe(true)
    expect(p.fade).toBe(true)
  })
  it("drops the blur and uses a more opaque scrim in fullscreen by default", () => {
    const p = barPaint({ ...base, fullscreen: true, fx: set() })
    expect(blurred(p)).toBe(false)
    expect(p.style.background).toContain(`${PLAYER_BAR_OPACITY_FULLSCREEN * 100}%`)
  })
  it("blur restores the fullscreen glass", () => {
    const p = barPaint({ ...base, fullscreen: true, fx: set("blur") })
    expect(blurred(p)).toBe(true)
    expect(p.style.background).not.toContain(`${PLAYER_BAR_OPACITY_FULLSCREEN * 100}%`)
  })
  it("solid removes the blur everywhere with the solid scrim", () => {
    for (const fullscreen of [false, true]) {
      const p = barPaint({ ...base, fullscreen, fx: set("solid") })
      expect(blurred(p)).toBe(false)
      expect(p.style.background).toContain(`${PLAYER_BAR_OPACITY_SOLID * 100}%`)
    }
  })
  it("layer adds the compositing hints", () => {
    const p = barPaint({ ...base, fullscreen: true, fx: set("layer") })
    expect(p.style).toMatchObject({ transform: "translateZ(0)", willChange: "opacity", isolation: "isolate" })
    expect(barPaint({ ...base, fullscreen: true, fx: set() }).style.transform).toBeUndefined()
  })
  it("noanim switches to visibility in fullscreen only", () => {
    const hidden = barPaint({ ...base, visible: false, fullscreen: true, fx: set("noanim") })
    expect(hidden.fade).toBe(false)
    expect(hidden.style).toMatchObject({ visibility: "hidden", opacity: 1 })
    expect(barPaint({ ...base, visible: true, fullscreen: true, fx: set("noanim") }).style.visibility).toBe("visible")
    const windowed = barPaint({ ...base, visible: false, fullscreen: false, fx: set("noanim") })
    expect(windowed.fade).toBe(true)
    expect(windowed.style.visibility).toBeUndefined()
  })
  it("the static (audio) bar keeps its own opacity", () => {
    const p = barPaint({ overlay: false, visible: true, fullscreen: false, fx: set() })
    expect(p.style.background).toContain("92%")
  })
})
