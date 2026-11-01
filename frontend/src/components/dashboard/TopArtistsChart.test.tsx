import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Artist } from "@/types/api"
import { TopArtistsChart } from "./TopArtistsChart"

const useArtists = vi.fn()
const useSettings = vi.fn()
vi.mock("@/hooks/useArtists", () => ({ useArtists: () => useArtists() }))
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => useSettings() }))

// jsdom has no layout, so recharts would draw nothing: the chart collapses to its rows.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    ResponsiveContainer: Passthrough,
    BarChart: ({ data }: { data: { name: string; count: number }[] }) => (
      <ul>
        {data.map((r) => (
          <li key={r.name}>{`${r.name}:${r.count}`}</li>
        ))}
      </ul>
    ),
    Bar: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  }
})

function artist(id: number, usageCount: number, isPrivate = false): Artist {
  return { id, name: `Artist ${id}`, usageCount, isPrivate } as Artist
}

const shown = () => screen.queryAllByRole("listitem").map((li) => li.textContent)

describe("TopArtistsChart", () => {
  beforeEach(() => {
    useSettings.mockReturnValue({ data: { privacyEnabled: false } })
  })
  afterEach(cleanup)

  it("shows private artists while privacy is off", () => {
    useArtists.mockReturnValue({ data: [artist(1, 10, true), artist(2, 5)], isLoading: false })
    render(<TopArtistsChart />)
    expect(shown()).toContain("Artist 1:10")
    expect(shown()).toContain("Artist 2:5")
  })

  it("hides private artists while privacy is on, and the next artists fill the 8 bars", () => {
    const artists = [artist(1, 100, true), ...Array.from({ length: 9 }, (_, i) => artist(i + 2, 50 - i))]
    useArtists.mockReturnValue({ data: artists, isLoading: false })
    useSettings.mockReturnValue({ data: { privacyEnabled: true } })
    render(<TopArtistsChart />)
    const rows = shown()
    expect(rows).toHaveLength(8)
    expect(rows.some((r) => r?.startsWith("Artist 1:"))).toBe(false)
    expect(rows).toContain("Artist 2:50")
    expect(rows).toContain("Artist 9:43")
    expect(rows).not.toContain("Artist 10:42")
  })

  it("shows No data yet when every candidate is private and privacy is on", () => {
    useArtists.mockReturnValue({ data: [artist(1, 10, true), artist(2, 5, true)], isLoading: false })
    useSettings.mockReturnValue({ data: { privacyEnabled: true } })
    render(<TopArtistsChart />)
    expect(screen.getByText("No data yet")).toBeInTheDocument()
    expect(shown()).toEqual([])
  })

  it("keeps artists without usage out", () => {
    useArtists.mockReturnValue({ data: [artist(1, 0), artist(2, 3)], isLoading: false })
    render(<TopArtistsChart />)
    expect(shown()).toEqual(["Artist 2:3"])
  })
})
