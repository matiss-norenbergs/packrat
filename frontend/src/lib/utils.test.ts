import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  calculateAge,
  cn,
  formatBytes,
  formatDownloadStatus,
  formatDuration,
  formatEta,
  formatSpeed,
  hashText,
  isAudioFilename,
} from "./utils"

describe("cn", () => {
  it("keeps non-conflicting classes", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold")
  })

  it("resolves conflicting tailwind utilities, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("drops falsy/conditional values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b")
  })
})

describe("formatBytes", () => {
  it("shows 0 B for zero or negative input", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(-5)).toBe("0 B")
  })

  it("stays in bytes below 1024, with no decimal", () => {
    expect(formatBytes(500)).toBe("500 B")
  })

  it("converts to KB/MB with one decimal place once past 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
  })
})

describe("formatSpeed", () => {
  it("shows an em dash for zero or negative input", () => {
    expect(formatSpeed(0)).toBe("—")
    expect(formatSpeed(-1)).toBe("—")
  })

  it("appends /s to the formatted byte size", () => {
    expect(formatSpeed(2048)).toBe("2.0 KB/s")
  })
})

describe("formatEta", () => {
  it("shows an em dash for null-ish or negative input", () => {
    expect(formatEta(-1)).toBe("—")
  })

  it("shows seconds only under a minute", () => {
    expect(formatEta(45)).toBe("45s")
  })

  it("shows minutes and seconds under an hour", () => {
    expect(formatEta(90)).toBe("1m 30s")
  })

  it("shows hours and minutes at or past an hour", () => {
    expect(formatEta(3661)).toBe("1h 1m")
  })
})

describe("formatDuration", () => {
  it("shows an em dash for null", () => {
    expect(formatDuration(null)).toBe("—")
  })

  it("pads seconds to two digits", () => {
    expect(formatDuration(5)).toBe("0:05")
    expect(formatDuration(65)).toBe("1:05")
  })

  it("doesn't cap minutes at 60", () => {
    expect(formatDuration(3725)).toBe("62:05")
  })
})

describe("calculateAge", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-26T12:00:00"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("hasn't decremented when the birthday already passed this year", () => {
    expect(calculateAge("2000-01-15")).toBe(26)
  })

  it("decrements when the birthday hasn't happened yet this year", () => {
    expect(calculateAge("2000-08-15")).toBe(25)
  })

  it("counts the birthday itself as the new age", () => {
    expect(calculateAge("2000-07-26")).toBe(26)
  })
})

describe("formatDownloadStatus", () => {
  it("uses the known label for a recognized status", () => {
    expect(formatDownloadStatus("completed")).toBe("Completed")
    expect(formatDownloadStatus("fetching_metadata")).toBe("Fetching Metadata")
  })

  it("title-cases an unrecognized status as a fallback", () => {
    expect(formatDownloadStatus("mystery")).toBe("Mystery")
  })
})

describe("isAudioFilename", () => {
  it("recognizes known audio extensions case-insensitively", () => {
    expect(isAudioFilename("song.mp3")).toBe(true)
    expect(isAudioFilename("SONG.MP3")).toBe(true)
  })

  it("rejects non-audio extensions", () => {
    expect(isAudioFilename("video.mp4")).toBe(false)
  })

  it("rejects filenames with no extension", () => {
    expect(isAudioFilename("noextension")).toBe(false)
  })
})

describe("hashText", () => {
  it("is deterministic for the same input", () => {
    expect(hashText("hello")).toBe(hashText("hello"))
  })

  it("produces a Hidden-prefixed 8-hex-digit placeholder", () => {
    expect(hashText("hello")).toMatch(/^Hidden-[0-9a-f]{8}$/)
  })

  it("differs for different inputs", () => {
    expect(hashText("hello")).not.toBe(hashText("world"))
  })
})
