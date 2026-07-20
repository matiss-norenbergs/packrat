// Seeks a media element to seekTo (if given) and optionally starts playback,
// but only once metadata is actually available.
//
// This is deliberately NOT wired up via the React onLoadedMetadata prop.
// For a fully browser-cached local file, the native 'loadedmetadata' event
// can fire the instant the element is inserted into the DOM — sometimes
// before React finishes attaching the listener during commit, since DOM
// insertion (which kicks off resource loading) and event-listener attachment
// aren't guaranteed to happen in an order that wins that race. When missed,
// the handler never runs at all: no seek, no play. Callers should instead
// invoke this from a useEffect (which runs strictly after commit) — by then
// el.readyState already reflects reality, so we check it directly instead
// of trying to catch a possibly-already-fired event.
export function syncMediaOnReady(el: HTMLMediaElement, seekTo: number | undefined, autoPlay: boolean) {
  const run = () => {
    if (seekTo != null && el.currentTime !== seekTo) {
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked)
        if (autoPlay) el.play()
      }
      el.addEventListener("seeked", onSeeked)
      el.currentTime = seekTo
    } else if (autoPlay) {
      el.play()
    }
  }

  if (el.readyState >= 1) {
    run()
    return () => {}
  }
  el.addEventListener("loadedmetadata", run)
  return () => el.removeEventListener("loadedmetadata", run)
}
