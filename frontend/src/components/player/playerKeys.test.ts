import { describe, expect, it } from "vitest"
import { resolveGlobalKey, targetHandlesKey, type KeyScopeInput, type KeyTarget } from "./playerKeys"

const base: KeyScopeInput = { key: " ", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, typing: false, inCell: false, target: null }
const run = (o: Partial<KeyScopeInput>) => resolveGlobalKey({ ...base, ...o })
const button: KeyTarget = { tag: "BUTTON", role: null, inputType: null, inMenu: false }
const seek: KeyTarget = { tag: "DIV", role: "slider", inputType: null, inMenu: false }
const range: KeyTarget = { tag: "INPUT", role: null, inputType: "range", inMenu: false }

describe("resolveGlobalKey", () => {
  it("maps the global shortcuts", () => {
    expect(run({ key: " " })).toEqual({ type: "toggle" })
    expect(run({ key: "K" })).toEqual({ type: "toggle" })
    expect(run({ key: "ArrowLeft" })).toEqual({ type: "seek", direction: -1, shift: false })
    expect(run({ key: "ArrowRight", shiftKey: true })).toEqual({ type: "seek", direction: 1, shift: true })
    expect(run({ key: "ArrowUp" })).toEqual({ type: "volume", direction: 1 })
    expect(run({ key: "ArrowDown" })).toEqual({ type: "volume", direction: -1 })
    expect(run({ key: "m" })).toEqual({ type: "mute" })
    expect(run({ key: "<" })).toEqual({ type: "speed", direction: -1 })
    expect(run({ key: ">" })).toEqual({ type: "speed", direction: 1 })
    expect(run({ key: "f" })).toEqual({ type: "fullscreen" })
    expect(run({ key: "q" })).toBeNull()
  })
  it("stays out while typing, with a modifier, when already handled, or when a cell has focus", () => {
    expect(run({ typing: true })).toBeNull()
    expect(run({ ctrlKey: true })).toBeNull()
    expect(run({ altKey: true })).toBeNull()
    expect(run({ metaKey: true })).toBeNull()
    expect(run({ defaultPrevented: true })).toBeNull()
    expect(run({ inCell: true })).toBeNull()
  })
  it("leaves Space/Enter to a focused button but still handles other keys", () => {
    expect(run({ target: button, key: " " })).toBeNull()
    expect(run({ target: button, key: "m" })).toEqual({ type: "mute" })
    expect(run({ target: { ...button, tag: "BUTTON", role: "switch" }, key: " " })).toBeNull()
  })
  it("leaves arrows to a focused slider but not M or Space", () => {
    expect(run({ target: seek, key: "ArrowLeft" })).toBeNull()
    expect(run({ target: range, key: "ArrowUp" })).toBeNull()
    expect(run({ target: seek, key: "m" })).toEqual({ type: "mute" })
    expect(run({ target: range, key: " " })).toEqual({ type: "toggle" })
  })
  it("a menu owns every key", () => {
    expect(run({ target: { tag: "DIV", role: "menuitemradio", inputType: null, inMenu: true }, key: "ArrowDown" })).toBeNull()
  })
})

describe("targetHandlesKey", () => {
  it("handles links and plain targets", () => {
    expect(targetHandlesKey({ tag: "A", role: null, inputType: null, inMenu: false }, "Enter")).toBe(true)
    expect(targetHandlesKey({ tag: "A", role: null, inputType: null, inMenu: false }, " ")).toBe(false)
    expect(targetHandlesKey(null, " ")).toBe(false)
    expect(targetHandlesKey({ tag: "DIV", role: null, inputType: null, inMenu: false }, " ")).toBe(false)
  })
})
