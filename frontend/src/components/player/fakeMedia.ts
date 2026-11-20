import { vi } from "vitest"

export interface FakeMediaState {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  playbackRate: number
  defaultPlaybackRate: number
}

// Test helper: jsdom's media elements don't play, so give a real element controllable state and working play/pause
// that fire the events the player listens to.
export function fakeMedia(el: HTMLMediaElement, init: { duration?: number; currentTime?: number } = {}): FakeMediaState {
  const s: Record<string, number | boolean> = {
    paused: true,
    ended: false,
    currentTime: init.currentTime ?? 0,
    duration: init.duration ?? 100,
    volume: 1,
    muted: false,
    playbackRate: 1,
    defaultPlaybackRate: 1,
  }
  for (const k of Object.keys(s)) {
    Object.defineProperty(el, k, {
      configurable: true,
      get: () => s[k],
      set: (v) => {
        s[k] = v
        if (k === "volume" || k === "muted") el.dispatchEvent(new Event("volumechange"))
        if (k === "currentTime") el.dispatchEvent(new Event("timeupdate"))
        if (k === "playbackRate") el.dispatchEvent(new Event("ratechange"))
      },
    })
  }
  el.play = vi.fn(() => {
    s.paused = false
    el.dispatchEvent(new Event("play"))
    return Promise.resolve()
  })
  el.pause = vi.fn(() => {
    s.paused = true
    el.dispatchEvent(new Event("pause"))
  })
  return s as unknown as FakeMediaState
}
