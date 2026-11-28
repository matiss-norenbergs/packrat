import type { QueryClient } from "@tanstack/react-query"
import { act } from "@testing-library/react"
import { latestClient } from "./clients"
import { tick } from "./tick"

// Deterministic replacements for "sleep a few ms and hope the work finished".
//
// A negative assertion ("the button never appeared", "nothing was requested") must be preceded by
// proof that the relevant work is done, not by wall-clock time. Use these after a positive
// sentinel (the request was made, the row rendered) and before asserting absence.

/**
 * Yield the event loop `rounds` times inside act(): promise continuations, React Query's
 * notify scheduler (a zero-delay timer) and the resulting React commits all run. This is a
 * zero-delay macrotask yield, not a wait for time to pass; timers already queued run first.
 */
export async function flushTasks(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await tick()
    })
  }
}

/**
 * Flush until the QueryClient has nothing fetching or mutating for two consecutive rounds, so a
 * query that only starts after an earlier one answered (a settings-gated request) is covered.
 * Throws if the queries never go quiet instead of letting the caller assert too early.
 */
export async function settleQueries(client: QueryClient | null = latestClient(), maxRounds = 100) {
  if (!client) throw new Error("settleQueries: no QueryClient (render with renderWithProviders or pass one)")
  let quiet = 0
  for (let i = 0; i < maxRounds && quiet < 2; i++) {
    await flushTasks(1)
    quiet = client.isFetching() + client.isMutating() === 0 ? quiet + 1 : 0
  }
  if (quiet < 2) throw new Error("settleQueries: queries never went idle")
}
