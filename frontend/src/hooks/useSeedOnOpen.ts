import { useEffect, useRef } from "react"

// Re-seeds an edit dialog's form state only when the dialog opens or when the thing being edited
// changes (`targetId`) — never because a background refetch handed the same row a new object
// identity. Depending on the server object in an effect re-seeded (and silently wiped) whatever the
// user had typed whenever a socket event invalidated the list. `seed` always runs with the latest
// render's closure, so a reopen starts from the latest server data.
export function useSeedOnOpen(open: boolean, targetId: unknown, seed: () => void) {
  const seedRef = useRef(seed)
  useEffect(() => {
    seedRef.current = seed
  })
  const prev = useRef<{ open: boolean; targetId: unknown }>({ open: false, targetId: undefined })
  useEffect(() => {
    const last = prev.current
    prev.current = { open, targetId }
    if (open && (!last.open || last.targetId !== targetId)) seedRef.current()
  }, [open, targetId])
}
