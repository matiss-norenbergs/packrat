import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./badge"

describe("Badge", () => {
  it("renders its children as text", () => {
    render(<Badge>Success</Badge>)
    expect(screen.getByText("Success")).toBeInTheDocument()
  })

  // Regression for the global cleanup hook (src/test/setup.ts): both tests render the same text,
  // so without a per-test unmount the second getByText would throw "multiple elements".
  it("renders the same text again without leaking the previous test's DOM", () => {
    render(<Badge variant="success">Success</Badge>)
    expect(screen.getByText("Success")).toHaveAttribute("data-variant", "success")
    expect(document.body.querySelectorAll("[data-slot='badge']")).toHaveLength(1)
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
