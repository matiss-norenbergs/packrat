import type { CSSProperties } from "react"
import { PLAYER_BAR_OPACITY, PLAYER_BAR_OPACITY_FULLSCREEN, PLAYER_BAR_OPACITY_SOLID, PLAYER_BAR_OPACITY_STATIC } from "./playerTheme"

// Diagnostic switches for the fullscreen control bar, read once from the URL: ?playerFx=layer,noanim
// (comma-separated, unknown names ignored). They are a permanent tool for a machine where the bar flickers or
// goes unpainted over a playing video; without a flag nothing changes: the bar is glass outside fullscreen and,
// in fullscreen, a solid, more opaque scrim with no backdrop-filter (see playerTheme.ts for why). Flags combine
// with that default.
//
// What testing on the machine that flickered (a 1280x534 H.264 clip) showed:
//   reproduce the flicker:        blur (the glass blur in fullscreen), layer (own compositor layer, made it worse)
//   mitigations to try if the     noanim, videolayer, solid (each also worked on top of the default)
//   default still flickers
//
//   blur        restore the glass blur in fullscreen too (the old behavior, for comparison)
//   layer       promote the bar to its own compositor layer (translateZ(0), will-change: opacity, isolation)
//   noanim      in fullscreen: no opacity transition; hide with visibility:hidden instead of opacity 0
//   videolayer  put the host's <video> into normal compositing (.player-fx-videolayer video in globals.css),
//               which can stop Chromium using a hardware overlay for it
//   solid       solid ~0.85 scrim and no backdrop-filter at all, in and out of fullscreen
//
// The on-screen debug box (?playerDebug=1) can itself hide these problems; use ?playerDebug=log (console only).
export type PlayerFx = "blur" | "layer" | "noanim" | "videolayer" | "solid"
const KNOWN: readonly PlayerFx[] = ["blur", "layer", "noanim", "videolayer", "solid"]

export function parsePlayerFx(search: string): ReadonlySet<PlayerFx> {
  const raw = new URLSearchParams(search).get("playerFx") ?? ""
  const out = new Set<PlayerFx>()
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase()
    if ((KNOWN as readonly string[]).includes(name)) out.add(name as PlayerFx)
  }
  return out
}

export interface BarPaint {
  style: CSSProperties
  /** Whether the bar keeps its opacity fade (class-level: transition-opacity). */
  fade: boolean
  /** Whether the glass blur is applied. */
  blur: boolean
}

/**
 * How the bar is painted for a given state. `overlay` = floating over a video (as opposed to the static bar
 * under audio); `visible` = the bar is currently shown.
 */
export function barPaint({ overlay, fullscreen, visible, fx }: { overlay: boolean; fullscreen: boolean; visible: boolean; fx: ReadonlySet<PlayerFx> }): BarPaint {
  const solid = fx.has("solid")
  const blur = !solid && (!fullscreen || fx.has("blur"))
  const alpha = !overlay ? PLAYER_BAR_OPACITY_STATIC : solid ? PLAYER_BAR_OPACITY_SOLID : fullscreen && !fx.has("blur") ? PLAYER_BAR_OPACITY_FULLSCREEN : PLAYER_BAR_OPACITY
  const style: CSSProperties = {
    background: `color-mix(in oklab, var(--player-scrim) ${alpha * 100}%, transparent)`,
  }
  if (blur) {
    style.backdropFilter = "blur(var(--player-bar-blur))"
    style.WebkitBackdropFilter = "blur(var(--player-bar-blur))"
  }
  if (fx.has("layer")) {
    style.transform = "translateZ(0)"
    style.willChange = "opacity"
    style.isolation = "isolate"
  }
  const noanim = overlay && fullscreen && fx.has("noanim")
  if (noanim) {
    style.visibility = visible ? "visible" : "hidden"
    style.opacity = 1
  }
  return { style, fade: !noanim, blur }
}
