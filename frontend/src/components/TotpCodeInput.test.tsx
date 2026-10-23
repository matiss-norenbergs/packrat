import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TotpCodeInput } from "@/components/TotpCodeInput"

afterEach(cleanup)

function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [v, setV] = useState("")
  return (
    <>
      <label htmlFor="c">Code</label>
      <TotpCodeInput id="c" value={v} onChange={setV} onComplete={onComplete} />
    </>
  )
}

describe("TotpCodeInput", () => {
  it("renders six boxes on a numeric, one-time-code, autofocused input", () => {
    const { container } = render(<Harness />)
    expect(container.querySelectorAll('[data-slot="input-otp-slot"]')).toHaveLength(6)
    const input = screen.getByLabelText("Code")
    expect(input).toHaveAttribute("inputmode", "numeric")
    expect(input).toHaveAttribute("autocomplete", "one-time-code")
    expect(input).toHaveFocus()
  })

  it("keeps digits only, caps at six and reports completion once", async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const user = userEvent.setup()
    await user.keyboard("1a2b3-45")
    expect(screen.getByLabelText("Code")).toHaveValue("12345")
    expect(onComplete).not.toHaveBeenCalled()
    await user.keyboard("678")
    expect(screen.getByLabelText("Code")).toHaveValue("123456")
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("123456")
  })

  it("accepts a pasted code and drops non-digit pastes", async () => {
    render(<Harness />)
    const user = userEvent.setup()
    await user.paste("12 34")
    expect(screen.getByLabelText("Code")).toHaveValue("")
    await user.paste("987654")
    expect(screen.getByLabelText("Code")).toHaveValue("987654")
  })
})
