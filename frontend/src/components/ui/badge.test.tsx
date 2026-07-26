import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./badge"

describe("Badge", () => {
  it("renders its children as text", () => {
    render(<Badge>Success</Badge>)
    expect(screen.getByText("Success")).toBeInTheDocument()
  })

  it("defaults to the default variant", () => {
    render(<Badge>Default</Badge>)
    expect(screen.getByText("Default")).toHaveAttribute("data-variant", "default")
  })

  it("reflects a non-default variant on the element", () => {
    render(<Badge variant="destructive">Failed</Badge>)
    expect(screen.getByText("Failed")).toHaveAttribute("data-variant", "destructive")
  })
})
