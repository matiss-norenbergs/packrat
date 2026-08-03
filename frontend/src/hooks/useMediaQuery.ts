import { useEffect, useState } from "react"

// Tracks whether a CSS media query currently matches, updating live as the
// viewport changes. Only needed for the rare layout decision that has to
// happen in JS rather than pure CSS — e.g. whether to mount a JS-driven
// layout library like react-resizable-panels at all, since its inline
// flex-basis styles would otherwise apply at every viewport size regardless
// of any Tailwind breakpoint classes layered on top.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
