import type { QueryClient } from "@tanstack/react-query"

// The QueryClient of the most recently rendered test tree, so `settleQueries()` needs no argument.
// `renderWithProviders` registers its own; a test that builds one wraps it: `trackClient(new QueryClient(...))`.
let latest: QueryClient | null = null
export function trackClient(client: QueryClient): QueryClient {
  latest = client
  return client
}
export const latestClient = () => latest
