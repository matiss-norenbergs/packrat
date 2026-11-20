import type { CSSProperties } from "react"
import { PLAYER_BAR_OPACITY, PLAYER_BAR_OPACITY_FULLSCREEN, PLAYER_BAR_OPACITY_SOLID, PLAYER_BAR_OPACITY_STATIC } from "./playerTheme"

// TEMPORARY switches for A/B testing the fullscreen control bar on a machine where it flickers, read once
// from the URL: ?playerFx=layer,noanim (comma-separated, unknown names ignored). Without any flag the bar is
// glass outside fullscreen and a solid, more opaque scrim in fullscreen (see playerTheme.ts). Flags combine
// with that default.
//
//   blur        restore the glass blur in fullscreen too (the old behavior, for comparison)
//   layer       promote the bar to its own compositor layer (translateZ(0), will-change: opacity, isolation)
//   noanim      in fullscreen: no opacity transition; hide with visibility:hidden instead of opacity 0
//   videolayer  put the host's <video> into normal compositing (.player-fx-videolayer video in globals.css),
//               which can stop Chromium using a hardware overlay for it
//   solid       solid ~0.85 scrim and no backdrop-filter at all, in and out of fullscreen
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
