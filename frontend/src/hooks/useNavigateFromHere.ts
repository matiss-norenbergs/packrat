import { useCallback, useContext } from "react"
import { UNSAFE_DataRouterContext, UNSAFE_NavigationContext } from "react-router-dom"

/**
 * Navigates to `to`, recording the current "path?search" as `state.from` (what the item page's back link returns to),
 * for the cards and cells of a long list.
 *
 * `useNavigate()` and `useLocation()` both re-render their component on every URL change (their context value is rebuilt
 * for each navigation), which for thousands of memoized cards means re-rendering every unchanged one on each filter or
 * sort change. The location is only needed when the user actually navigates, so this hook reads it then, and its
 * identity never changes. Under the app's data router it reads the router's own state; without one (a plain
 * MemoryRouter in a test) it reads the history's location, falling back to the window's.
 */
export function useNavigateFromHere(): (to: string) => void {
  const router = useContext(UNSAFE_DataRouterContext)?.router
  const { navigator } = useContext(UNSAFE_NavigationContext)
  return useCallback(
    (to: string) => {
      const location = router?.state.location ?? (navigator as { location?: Location }).location ?? window.location
      navigator.push(to, { from: `${location.pathname}${location.search}` })
    },
    [router, navigator],
  )
}
