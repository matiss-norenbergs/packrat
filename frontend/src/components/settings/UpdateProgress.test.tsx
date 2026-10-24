import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { UpdateProgress } from "@/components/settings/UpdateProgress"

afterEach(cleanup)

describe("UpdateProgress", () => {
  it("shows the label, percent, bar and restart notice on separate elements", () => {
    render(<UpdateProgress downloaded={18} total={100} />)
    expect(screen.getByText("Downloading update…")).toBeInTheDocument()
    expect(screen.getByText("18%")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "18")
    expect(screen.getByText("Packrat will restart when it's done.")).toBeInTheDocument()
  })

  it("caps the percent at 100", () => {
    render(<UpdateProgress downloaded={150} total={100} />)
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("is indeterminate with no percent when the total size is unknown", () => {
    render(<UpdateProgress downloaded={4096} />)
    expect(screen.getByText("Downloading…")).toBeInTheDocument()
    expect(screen.queryByText(/%/)).toBeNull()
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow")
    expect(screen.getByText("Packrat will restart when it's done.")).toBeInTheDocument()
  })
})
