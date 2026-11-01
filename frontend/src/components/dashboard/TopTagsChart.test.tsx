import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Tag } from "@/types/api"
import { TopTagsChart } from "./TopTagsChart"

const useTags = vi.fn()
const useSettings = vi.fn()
vi.mock("@/hooks/useTags", () => ({ useTags: () => useTags() }))
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

function tag(id: number, usageCount: number, isPrivate = false): Tag {
  return { id, name: `Tag ${id}`, usageCount, isPrivate } as Tag
}

const shown = () => screen.queryAllByRole("listitem").map((li) => li.textContent)

describe("TopTagsChart", () => {
  beforeEach(() => {
    useSettings.mockReturnValue({ data: { privacyEnabled: false } })
  })
  afterEach(cleanup)

  it("shows private tags while privacy is explicitly off", () => {
    useTags.mockReturnValue({ data: [tag(1, 10, true), tag(2, 5)], isLoading: false })
    render(<TopTagsChart />)
    expect(shown()).toEqual(["Tag 2:5", "Tag 1:10"])
  })

  it("hides private tags while privacy is on", () => {
    useTags.mockReturnValue({ data: [tag(1, 10, true), tag(2, 5)], isLoading: false })
    useSettings.mockReturnValue({ data: { privacyEnabled: true } })
    render(<TopTagsChart />)
    expect(shown()).toEqual(["Tag 2:5"])
  })

  it("treats unknown settings as privacy on: private tags are not listed", () => {
    useTags.mockReturnValue({ data: [tag(1, 10, true), tag(2, 5)], isLoading: false })
    useSettings.mockReturnValue({ data: undefined })
    render(<TopTagsChart />)
    expect(shown()).toEqual(["Tag 2:5"])
  })

  it("shows No data yet while settings are unknown and every tag is private", () => {
    useTags.mockReturnValue({ data: [tag(1, 10, true)], isLoading: false })
    useSettings.mockReturnValue({ data: undefined })
    render(<TopTagsChart />)
    expect(screen.getByText("No data yet")).toBeInTheDocument()
  })
})
