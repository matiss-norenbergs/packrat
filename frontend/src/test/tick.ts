// One zero-delay macrotask yield: promise continuations and timers already queued run first.
// Not a wait for time to pass; for DOM-free tests (lib/) where Testing Library's act() is not involved.
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
