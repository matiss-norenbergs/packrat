import { useCallback, useState } from "react"

// A page number that goes back to 1 whenever `resetKey` changes (filters, search, sort...). The reset is a state
// adjustment during render (the pattern of `useResetOnChange` in DataTable): React re-renders at once, and the discarded
// render never reaches a query hook's subscription, so nothing is requested for the new key with the old page.
// The returned page is already 1 in that first pass. Not on mount.
export function usePageState(resetKey: string): [page: number, setPage: (page: number) => void] {
  const [state, setState] = useState({ page: 1, key: resetKey })
  if (state.key !== resetKey) setState({ page: 1, key: resetKey })
  const setPage = useCallback((page: number) => setState({ page, key: resetKey }), [resetKey])
  return [state.key === resetKey ? state.page : 1, setPage]
}
