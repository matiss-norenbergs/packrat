import { useSyncExternalStore } from "react"
import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/motion"

/** Live `prefers-reduced-motion: reduce`; false where `matchMedia` is missing. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}
