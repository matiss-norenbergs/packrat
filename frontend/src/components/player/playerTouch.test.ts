import { describe, expect, it } from "vitest"
import {
  INITIAL_TAP_STATE,
  feedTap,
  formatSkip,
  fullscreenMode,
  initialInputKind,
  inputKindFromPointerType,
  isTap,
  resolveTapTimeout,
  showUnmuteButton,
  skipTarget,
  tapZone,
  unmuteAction,
  type TapState,
  type TapZone,
} from "./playerTouch"

const cfg = { doubleTapMs: 300, accumulateMs: 700, skipSeconds: 10 }

describe("inputKindFromPointerType", () => {
  it("maps touch and pen to touch, mouse to mouse", () => {
    expect(inputKindFromPointerType("touch", "mouse")).toBe("touch")
    expect(inputKindFromPointerType("pen", "mouse")).toBe("touch")
    expect(inputKindFromPointerType("mouse", "touch")).toBe("mouse")
  })
  it("keeps the previous kind for an empty or unknown type", () => {
    expect(inputKindFromPointerType("", "touch")).toBe("touch")
    expect(inputKindFromPointerType(undefined, "mouse")).toBe("mouse")
    expect(inputKindFromPointerType("kinect", "touch")).toBe("touch")
  })
})

describe("initialInputKind", () => {
  it("guesses touch for a coarse pointer, mouse otherwise or without matchMedia", () => {
    expect(initialInputKind((q) => ({ matches: q === "(pointer: coarse)" }))).toBe("touch")
    expect(initialInputKind(() => ({ matches: false }))).toBe("mouse")
    expect(initialInputKind(undefined)).toBe("mouse")
    expect(
      initialInputKind(() => {
        throw new Error("no")
      }),
    ).toBe("mouse")
  })
})

describe("tapZone", () => {
  it("splits the frame into thirds", () => {
    expect(tapZone(0, 0, 300)).toBe("left")
    expect(tapZone(99, 0, 300)).toBe("left")
    expect(tapZone(100, 0, 300)).toBe("middle")
    expect(tapZone(199, 0, 300)).toBe("middle")
    expect(tapZone(200, 0, 300)).toBe("right")
    expect(tapZone(300, 0, 300)).toBe("right")
    expect(tapZone(150, 100, 300)).toBe("left") // offset frame
  })
  it("treats an empty frame or a bad position as the middle", () => {
    expect(tapZone(10, 0, 0)).toBe("middle")
    expect(tapZone(Number.NaN, 0, 300)).toBe("middle")
  })
})

describe("isTap", () => {
  it("accepts small movement and rejects a drag", () => {
    expect(isTap(100, 100, 100, 100, 10)).toBe(true)
    expect(isTap(100, 100, 106, 108, 10)).toBe(true) // exactly 10 px
    expect(isTap(100, 100, 111, 100, 10)).toBe(false)
    expect(isTap(100, 100, 100, 60, 10)).toBe(false) // a scroll
  })
})

// Runs a sequence of taps (time, zone) and collects what happened.
function run(taps: [number, TapZone][], start: TapState = INITIAL_TAP_STATE) {
  let state = start
  const out: string[] = []
  for (const [t, zone] of taps) {
    const r = feedTap(state, t, zone, cfg)
    state = r.state
    if (r.single) out.push("single")
    if (r.skip) out.push(`skip ${r.skip.delta} (${r.skip.total})`)
    if (r.wait) out.push("wait")
  }
  return { state, out }
}

describe("feedTap / resolveTapTimeout", () => {
  it("a lone tap waits, then becomes a single tap after the window", () => {
    const { state, out } = run([[1000, "middle"]])
    expect(out).toEqual(["wait"])
    expect(resolveTapTimeout(state, 1300, cfg).single).toBe(false) // not yet (inclusive window)
    const r = resolveTapTimeout(state, 1301, cfg)
    expect(r.single).toBe(true)
    expect(r.state.pending).toBeNull()
  })

  it("a double tap on the right skips +10, on the left -10, with no single tap", () => {
    expect(run([[1000, "right"], [1200, "right"]]).out).toEqual(["wait", "skip 10 (10)"])
    expect(run([[1000, "left"], [1200, "left"]]).out).toEqual(["wait", "skip -10 (-10)"])
  })

  it("a second tap exactly at the window boundary is still a double tap; one ms later is not", () => {
    expect(run([[1000, "right"], [1300, "right"]]).out).toEqual(["wait", "skip 10 (10)"])
    // The first tap's timer was late: it resolves as a single tap and the second starts over.
    expect(run([[1000, "right"], [1301, "right"]]).out).toEqual(["wait", "single", "wait"])
  })

  it("a double tap in the middle third does nothing (and consumes both taps)", () => {
    const { state, out } = run([[1000, "middle"], [1100, "middle"]])
    expect(out).toEqual(["wait"])
    expect(state).toEqual({ pending: null, streak: null })
    expect(resolveTapTimeout(state, 5000, cfg).single).toBe(false)
  })

  it("the second tap's zone decides the double tap", () => {
    expect(run([[1000, "middle"], [1100, "right"]]).out).toEqual(["wait", "skip 10 (10)"])
  })

  it("further taps on the same side accumulate +10, +20, +30", () => {
    const { out } = run([
      [1000, "right"],
      [1150, "right"],
      [1500, "right"],
      [2000, "right"],
    ])
    expect(out).toEqual(["wait", "skip 10 (10)", "skip 10 (20)", "skip 10 (30)"])
  })

  it("accumulates on the left side too, measuring each window from the last tap (inclusive)", () => {
    const { out } = run([
      [0, "left"],
      [100, "left"],
      [800, "left"], // exactly 700 ms after the last tap
    ])
    expect(out).toEqual(["wait", "skip -10 (-10)", "skip -10 (-20)"])
  })

  it("a stale streak starts over as a fresh first tap", () => {
    const { out } = run([
      [0, "right"],
      [100, "right"],
      [801, "right"], // 701 ms later
    ])
    expect(out).toEqual(["wait", "skip 10 (10)", "wait"])
  })

  it("a third tap on the other side resets the accumulation", () => {
    const { state, out } = run([
      [0, "right"],
      [100, "right"],
      [300, "left"],
    ])
    expect(out).toEqual(["wait", "skip 10 (10)", "wait"])
    expect(state.streak).toBeNull()
    // ...and can become a double tap on its own side, starting at -10 again.
    expect(run([[400, "left"]], state).out).toEqual(["skip -10 (-10)"])
  })

  it("a middle tap during a streak ends it and waits", () => {
    const { state, out } = run([
      [0, "left"],
      [100, "left"],
      [200, "middle"],
    ])
    expect(out).toEqual(["wait", "skip -10 (-10)", "wait"])
    expect(resolveTapTimeout(state, 501, cfg).single).toBe(true)
  })

  it("resolveTapTimeout without a pending tap is a no-op", () => {
    expect(resolveTapTimeout(INITIAL_TAP_STATE, 99999, cfg)).toEqual({ state: INITIAL_TAP_STATE, single: false })
  })
})

describe("skipTarget", () => {
  it("clamps to [0, duration]", () => {
    expect(skipTarget(50, 10, 100)).toBe(60)
    expect(skipTarget(95, 10, 100)).toBe(100)
    expect(skipTarget(4, -10, 100)).toBe(0)
  })
  it("with an unknown duration only clamps at 0", () => {
    expect(skipTarget(50, 10, Number.NaN)).toBe(60)
    expect(skipTarget(50, 10, Infinity)).toBe(60)
    expect(skipTarget(50, 10, 0)).toBe(60)
    expect(skipTarget(5, -10, Number.NaN)).toBe(0)
    expect(skipTarget(Number.NaN, 10, 100)).toBe(10)
  })
})

describe("formatSkip", () => {
  it("signs the running total", () => {
    expect(formatSkip(10)).toBe("+10 s")
    expect(formatSkip(30)).toBe("+30 s")
    expect(formatSkip(-20)).toBe("−20 s")
  })
})

describe("showUnmuteButton / unmuteAction", () => {
  it("shows only in touch mode while muted or at volume 0", () => {
    expect(showUnmuteButton(true, true, 1)).toBe(true)
    expect(showUnmuteButton(true, false, 0)).toBe(true)
    expect(showUnmuteButton(true, false, 0.5)).toBe(false)
    expect(showUnmuteButton(false, true, 0)).toBe(false)
  })
  it("raises a zero volume to 1, otherwise just unmutes", () => {
    expect(unmuteAction(true, 0.4)).toBe("unmute")
    expect(unmuteAction(false, 0)).toBe("volume")
    expect(unmuteAction(true, 0)).toBe("volume")
    expect(unmuteAction(false, 0.4)).toBeNull()
  })
})

describe("fullscreenMode", () => {
  it("uses the frame when the Fullscreen API is available", () => {
    expect(fullscreenMode({ fullscreenEnabled: true, canRequest: true, canWebkitEnter: true })).toBe("frame")
    expect(fullscreenMode({ fullscreenEnabled: true, canRequest: true, canWebkitEnter: false })).toBe("frame")
  })
  it("falls back to the video's native fullscreen (iPhone Safari)", () => {
    expect(fullscreenMode({ fullscreenEnabled: false, canRequest: false, canWebkitEnter: true })).toBe("native")
    expect(fullscreenMode({ fullscreenEnabled: false, canRequest: true, canWebkitEnter: true })).toBe("native")
    expect(fullscreenMode({ fullscreenEnabled: true, canRequest: false, canWebkitEnter: true })).toBe("native")
  })
  it("shows no button when neither works", () => {
    expect(fullscreenMode({ fullscreenEnabled: false, canRequest: false, canWebkitEnter: false })).toBe("none")
    expect(fullscreenMode({ fullscreenEnabled: false, canRequest: true, canWebkitEnter: false })).toBe("none")
    expect(fullscreenMode({ fullscreenEnabled: true, canRequest: false, canWebkitEnter: false })).toBe("none")
  })
  it("tries the frame when the browser doesn't say (as before)", () => {
    expect(fullscreenMode({ fullscreenEnabled: undefined, canRequest: false, canWebkitEnter: false })).toBe("frame")
    expect(fullscreenMode({ fullscreenEnabled: undefined, canRequest: true, canWebkitEnter: true })).toBe("frame")
    expect(fullscreenMode({ fullscreenEnabled: undefined, canRequest: false, canWebkitEnter: true })).toBe("native")
  })
})
