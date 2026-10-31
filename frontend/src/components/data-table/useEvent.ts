import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * A callback with a permanently stable identity that always calls the latest `fn`. Lets memoized children take
 * handlers built from the page's inline lambdas without re-rendering when those lambdas change. The ref is
 * updated in a layout effect (never during render), so it is current before any event can fire.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
