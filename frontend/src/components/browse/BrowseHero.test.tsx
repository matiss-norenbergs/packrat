import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"
import type { LibraryItem } from "@/types/api"
import { BrowseHero } from "./BrowseHero"

afterEach(cleanup)

const items = [1, 2, 3].map((id) => ({ id, title: `Item ${id}`, path: `media/${id}.mp4`, thumbnail: null, status: "ready" }) as unknown as LibraryItem)

const renderHero = () =>
  render(
    <MemoryRouter>
      <BrowseHero items={items} />
    </MemoryRouter>,
  )

describe("BrowseHero focus reveal", () => {
  it("Previous / Pause / Next are revealed while they (or anything in the hero) have focus", async () => {
    const user = userEvent.setup()
    renderHero()
    for (const name of ["Previous", "Pause", "Next"]) {
      await user.tab()
      const btn = screen.getByRole("button", { name })
      expect(btn).toHaveFocus()
      // Hidden at rest, shown on hover and when focus is anywhere in the hero (as BrowseTile does for its menu).
      const row = btn.parentElement!
      expect(row).toHaveClass("opacity-0", "group-hover/hero:opacity-100", "group-focus-within/hero:opacity-100")
    }
  })
})
