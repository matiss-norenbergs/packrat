import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { LibraryItem } from "@/types/api"
import { BrowseHero } from "./BrowseHero"

function stubReducedMotion(reduce: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches: reduce,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal("matchMedia", () => mq)
  return {
    set: (v: boolean) => {
      mq.matches = v
      act(() => listeners.forEach((l) => l()))
    },
  }
}

// The active segment's fill: its animation-play-state is the pause signal (rotation advances on animationend).
const fill = (c: HTMLElement) => c.querySelector<HTMLElement>("[style*='hero-progress-fill'], .bg-white.h-full:not(.w-full)")

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

describe("BrowseHero pause and motion", () => {
  const state = (c: HTMLElement) => fill(c)!.style.animationPlayState

  it("pauses while focus is inside the hero and resumes when it leaves", async () => {
    const user = userEvent.setup()
    stubReducedMotion(false)
    const { container } = renderHero()
    expect(state(container)).toBe("running")
    await user.tab()
    expect(screen.getByRole("button", { name: "Previous" })).toHaveFocus()
    expect(state(container)).toBe("paused")
    await user.tab() // still inside
    expect(state(container)).toBe("paused")
    await user.tab()
    await user.tab() // Play link
    expect(screen.getByRole("link", { name: "Play" })).toHaveFocus()
    expect(state(container)).toBe("paused")
    await user.tab() // out of the hero
    expect(state(container)).toBe("running")
  })

  it("keeps the pause when only the window loses focus", async () => {
    const user = userEvent.setup()
    stubReducedMotion(false)
    const { container } = renderHero()
    await user.tab()
    const btn = screen.getByRole("button", { name: "Previous" })
    fireEvent.blur(btn, { relatedTarget: null }) // window/tab blur: activeElement stays in the hero
    expect(state(container)).toBe("paused")
  })

  it("starts paused under reduced motion, and Play starts it", () => {
    stubReducedMotion(true)
    const { container } = renderHero()
    expect(state(container)).toBe("paused")
    fireEvent.click(screen.getByRole("button", { name: "Play" })) // no pointer: stay unhovered, unfocused
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument()
    expect(state(container)).toBe("running")
  })

  it("follows a change of the preference until the user chooses", () => {
    const mm = stubReducedMotion(false)
    const { container } = renderHero()
    expect(state(container)).toBe("running")
    mm.set(true)
    expect(state(container)).toBe("paused")
  })

  it("Next still advances under reduced motion", async () => {
    const user = userEvent.setup()
    stubReducedMotion(true)
    renderHero()
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("heading", { name: "Item 2" })).toBeInTheDocument()
  })
})
