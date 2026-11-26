const QUERY = "(prefers-reduced-motion: reduce)"

/** True when the OS asks for reduced motion. Safe without `matchMedia` (SSR, jsdom). */
export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches

/** The `behavior` for programmatic scrolling: instant under reduced motion, smooth otherwise (read at call time). */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth")

/** Subscribes to changes of the reduced-motion preference (for `useSyncExternalStore`). */
export function subscribeReducedMotion(onChange: () => void) {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(QUERY) : undefined
  if (!mq) return () => {}
  mq.addEventListener?.("change", onChange)
  return () => mq.removeEventListener?.("change", onChange)
}
