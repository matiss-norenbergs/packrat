import { act, cleanup, render, screen } from "@testing-library/react"
import { useRef, type RefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlayerSkin } from "./PlayerSkin"
import { androidImmersiveBridge, useAndroidImmersive } from "./useAndroidImmersive"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

// The Android shell's bridge (MainActivity.kt) as the page sees it.
let bridge: { setImmersive: ReturnType<typeof vi.fn> } | undefined
let fullscreenElement: Element | null = null

beforeEach(() => {
  fullscreenElement = null
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement })
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
  document.exitFullscreen = vi.fn(async () => setFullscreen(null))
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})
afterEach(() => {
  cleanup()
  leaveTauri()
  delete (window as unknown as Record<string, unknown>).PackratAndroid
  bridge = undefined
  vi.unstubAllGlobals()
})

function installBridge() {
  bridge = { setImmersive: vi.fn() }
  ;(window as unknown as Record<string, unknown>).PackratAndroid = bridge
}

function setFullscreen(el: Element | null) {
  fullscreenElement = el
  document.dispatchEvent(new Event("fullscreenchange"))
}

function Frame() {
  const ref = useRef<HTMLDivElement>(null)
  useAndroidImmersive(ref)
  return <div ref={ref} data-testid="frame" />
}

const frame = () => screen.getByTestId("frame")

describe("useAndroidImmersive", () => {
  it("hides the bars when the frame goes fullscreen and shows them when it leaves", () => {
    enterTauri("android")
    installBridge()
    render(<Frame />)
    act(() => setFullscreen(frame()))
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(true)
    act(() => setFullscreen(null))
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(false)
    expect(bridge!.setImmersive).toHaveBeenCalledTimes(2)
  })

  it("ignores fullscreen of some other element", () => {
    enterTauri("android")
    installBridge()
    render(<Frame />)
    act(() => setFullscreen(document.body))
    expect(bridge!.setImmersive).not.toHaveBeenCalled()
  })

  it("restores the bars and leaves fullscreen when the app goes to the background", () => {
    enterTauri("android")
    installBridge()
    render(<Frame />)
    act(() => setFullscreen(frame()))
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(false)
    expect(document.exitFullscreen).toHaveBeenCalledOnce()
  })

  it("restores the bars when the player unmounts (navigating away)", () => {
    enterTauri("android")
    installBridge()
    const view = render(<Frame />)
    act(() => setFullscreen(frame()))
    view.unmount()
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(false)
    expect(document.exitFullscreen).toHaveBeenCalledOnce()
  })

  it("does nothing on unmount when not fullscreen", () => {
    enterTauri("android")
    installBridge()
    render(<Frame />).unmount()
    expect(bridge!.setImmersive).not.toHaveBeenCalled()
  })

  it("is a no-op without the bridge (Android shell built without it)", () => {
    enterTauri("android")
    expect(androidImmersiveBridge()).toBeNull()
    render(<Frame />)
    expect(() => act(() => setFullscreen(frame()))).not.toThrow()
  })

  it.each([
    ["web", () => {}],
    ["desktop app", () => enterTauri("desktop")],
  ])("never calls a PackratAndroid object on the %s", (_name, enter) => {
    enter()
    installBridge()
    expect(androidImmersiveBridge()).toBeNull()
    render(<Frame />)
    act(() => setFullscreen(frame()))
    expect(bridge!.setImmersive).not.toHaveBeenCalled()
  })

  it("survives a bridge that throws", () => {
    enterTauri("android")
    ;(window as unknown as Record<string, unknown>).PackratAndroid = {
      setImmersive: () => {
        throw new Error("boom")
      },
    }
    render(<Frame />)
    expect(() => act(() => setFullscreen(frame()))).not.toThrow()
  })
})

describe("PlayerSkin on Android", () => {
  function Player() {
    const ref = useRef<HTMLVideoElement>(null)
    return (
      <PlayerSkin mediaRef={ref as RefObject<HTMLMediaElement | null>} kind="video" variant="full">
        <video ref={ref} data-testid="media" />
      </PlayerSkin>
    )
  }

  it("drives the bridge from its own frame's fullscreen", () => {
    enterTauri("android")
    installBridge()
    render(<Player />)
    const skinFrame = screen.getByTestId("media").parentElement!.closest("[tabindex]") ?? screen.getByTestId("media").parentElement!
    act(() => setFullscreen(skinFrame))
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(true)
    act(() => setFullscreen(null))
    expect(bridge!.setImmersive).toHaveBeenLastCalledWith(false)
  })
})
