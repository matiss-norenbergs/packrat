import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UseFetchedTitleInput } from "./UseFetchedTitleInput"

afterEach(cleanup)

function Harness({ previewTitle, initial = "" }: { previewTitle?: string; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <TooltipProvider>
      <UseFetchedTitleInput
        id="t"
        placeholder={previewTitle || "Video title"}
        value={value}
        onChange={setValue}
        previewTitle={previewTitle}
      />
    </TooltipProvider>
  )
}

const BUTTON = { name: "Use the fetched title" }

describe("UseFetchedTitleInput", () => {
  it("hides the button without a preview title", () => {
    render(<Harness />)
    expect(screen.queryByRole("button", BUTTON)).toBeNull()
    expect(screen.getByPlaceholderText("Video title")).toBeTruthy()
  })

  it("fills the field, focuses it with the cursor at the end, then hides", async () => {
    const user = userEvent.setup()
    render(<Harness previewTitle="Fetched Title" />)
    const input = screen.getByRole("textbox") as HTMLInputElement
    // Never pre-filled; placeholder still shows the fetched title.
    expect(input.value).toBe("")
    expect(input.placeholder).toBe("Fetched Title")

    await user.click(screen.getByRole("button", BUTTON))

    expect(input.value).toBe("Fetched Title")
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe("Fetched Title".length)
    expect(input.selectionEnd).toBe("Fetched Title".length)
    expect(screen.queryByRole("button", BUTTON)).toBeNull()
  })

  it("comes back once the text is edited away from the title", async () => {
    const user = userEvent.setup()
    render(<Harness previewTitle="Fetched Title" initial="Fetched Title" />)
    expect(screen.queryByRole("button", BUTTON)).toBeNull()

    await user.type(screen.getByRole("textbox"), "!")

    expect(screen.getByRole("button", BUTTON)).toBeTruthy()
  })
})
