// Every size, duration, blur, opacity and timing of the media player skin lives here, so
// "less blur" or "bigger handle" is a one-line change. PlayerSkin writes the CSS-valued ones
// onto the frame as custom properties (see playerCssVars); the rest are read by the logic.

export const PLAYER_HOT_ZONE_FRACTION = 0.2 // bottom share of the frame where a hovering pointer shows the bar and keeps it shown
export const PLAYER_HIDE_DELAY_MS = 2500 // idle time before the bar hides while playing
export const PLAYER_FADE_MS = 200 // bar fade in/out
export const PLAYER_CLICK_DELAY_MS = 220 // wait for a possible double-click before toggling play
export const PLAYER_FLASH_MS = 500 // centered play/pause pulse
export const PLAYER_OSD_MS = 900 // seek/volume/speed indicator

// Touch mode (the item page's video on a phone/tablet; see playerTouch.ts).
export const PLAYER_DOUBLE_TAP_MS = 300 // a second tap within this window is a double tap (a single tap waits this long)
export const PLAYER_SKIP_ACCUMULATE_MS = 700 // further taps on the same side within this window add another skip
export const PLAYER_TOUCH_SKIP_S = 10 // seconds per double-tap skip
export const PLAYER_TAP_SLOP_PX = 10 // a press that moved further than this is a drag/scroll, not a tap
export const PLAYER_SKIP_INDICATOR_MS = 800 // how long the "+10 s" indicator stays after the last skip
export const PLAYER_CENTER_BTN_PX = 64 // the big play/pause button in the middle
export const PLAYER_TOUCH_TARGET_PX = 44 // minimum size of a touch button
export const PLAYER_TOUCH_SEEK_HIT_PX = 44 // seek bar hit area height in touch mode (the visible track stays thin)
export const PLAYER_TOUCH_SCRIM_OPACITY = 0.3 // dim over the whole picture while the touch controls are shown
export const PLAYER_TOUCH_SCRIM_EDGE_OPACITY = 0.75 // extra darkening at the top and bottom edges (behind the rows)

export const PLAYER_BAR_RADIUS_PX = 14
export const PLAYER_BAR_INSET_PX = 12 // gap between the bar and the video's edges
export const PLAYER_BAR_BLUR_PX = 14
export const PLAYER_BAR_OPACITY = 0.55 // scrim alpha (0-1) of the glass bar
export const PLAYER_BAR_PADDING_PX = 10

export const PLAYER_SEEK_TRACK_PX = 4
export const PLAYER_SEEK_TRACK_HOVER_PX = 7
export const PLAYER_SEEK_HANDLE_PX = 14
export const PLAYER_SEEK_HIT_PX = 20 // pointer hit area height around the track
export const PLAYER_BUFFERED_OPACITY = 0.3
export const PLAYER_HAIRLINE_PX = 2 // idle progress line at the bottom edge while the bar is hidden

export const PLAYER_VOLUME_SLIDER_PX = 72 // width of the slid-out volume slider
export const PLAYER_ICON_PX = 18
export const PLAYER_FLASH_SIZE_PX = 64

export const PLAYER_SEEK_STEP_S = 5
export const PLAYER_SEEK_STEP_LARGE_S = 10
export const PLAYER_VOLUME_STEP = 0.05
export const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
export const PLAYER_DEFAULT_SPEED = 1

/** CSS custom properties consumed by the player's classes (width of fonts etc. stay in Tailwind). */
export function playerCssVars(): Record<string, string> {
  return {
    "--player-bar-radius": `${PLAYER_BAR_RADIUS_PX}px`,
    "--player-bar-inset": `${PLAYER_BAR_INSET_PX}px`,
    "--player-bar-blur": `${PLAYER_BAR_BLUR_PX}px`,
    "--player-bar-opacity": String(PLAYER_BAR_OPACITY),
    "--player-bar-opacity-static": String(PLAYER_BAR_OPACITY_STATIC),
    "--player-bar-padding": `${PLAYER_BAR_PADDING_PX}px`,
    "--player-fade": `${PLAYER_FADE_MS}ms`,
    "--player-track": `${PLAYER_SEEK_TRACK_PX}px`,
    "--player-track-hover": `${PLAYER_SEEK_TRACK_HOVER_PX}px`,
    "--player-handle": `${PLAYER_SEEK_HANDLE_PX}px`,
    "--player-seek-hit": `${PLAYER_SEEK_HIT_PX}px`,
    "--player-buffered-opacity": String(PLAYER_BUFFERED_OPACITY),
    "--player-hairline": `${PLAYER_HAIRLINE_PX}px`,
    "--player-volume-slider": `${PLAYER_VOLUME_SLIDER_PX}px`,
    "--player-flash-size": `${PLAYER_FLASH_SIZE_PX}px`,
    "--player-flash-ms": `${PLAYER_FLASH_MS}ms`,
    "--player-center-btn": `${PLAYER_CENTER_BTN_PX}px`,
    "--player-touch-target": `${PLAYER_TOUCH_TARGET_PX}px`,
    "--player-touch-seek-hit": `${PLAYER_TOUCH_SEEK_HIT_PX}px`,
  }
}

export const PLAYER_BAR_OPACITY_STATIC = 0.92 // scrim alpha when the bar sits on a page, not over a video (audio, mini player)
export const PLAYER_COMPACT_INSET_PX = 6
export const PLAYER_COVER_PX = 36 // compact audio cover

// In fullscreen the glass bar drops its backdrop-filter and uses a more opaque solid scrim. Finding: on one
// machine a blurred bar over a playing 1280x534 H.264 clip flickered or vanished in fullscreen (the DOM state
// was correct, the bar just wasn't painted), even combined with the other mitigations (no fade, plain video
// layer) and worse with its own compositor layer; the solid scrim was the tested fix. Presumably Chromium
// promotes the video to a hardware overlay there and compositing a backdrop filter over it is unreliable.
// Outside fullscreen the glass look is unchanged. See playerFx.ts for the switches that reproduce/mitigate it.
export const PLAYER_BAR_OPACITY_FULLSCREEN = 0.78
// `?playerFx=solid`: solid scrim and no backdrop-filter anywhere (a diagnostic switch).
export const PLAYER_BAR_OPACITY_SOLID = 0.85
