import type { ReactElement } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"

type Init = RequestInit & { headers: Record<string, string> }
export type Responder = (url: string, init: Init) => { status: number; body?: unknown; headers?: Record<string, string> }

// Stubs fetch with a responder keyed by the request; records every call for assertions.
export function mockFetch(responder: Responder) {
  const fn = vi.fn(async (url: string, init: Init) => {
    const { status, body, headers } = responder(url, init)
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: { get: (name: string) => headers?.[name] ?? null },
      json: async () => body ?? {},
    }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

export const callsTo = (fn: ReturnType<typeof mockFetch>, path: string) => fn.mock.calls.filter(([url]) => url.endsWith(path))
export const bodyOf = (call: unknown[]) => JSON.parse(((call[1] as RequestInit).body as string) ?? "{}")

export function renderWithProviders(ui: ReactElement, route = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  // Tables with a tableId wait for the account's saved layouts; no saved layouts, so they render at once.
  client.setQueryData(tableLayoutsQueryKey, {})
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
