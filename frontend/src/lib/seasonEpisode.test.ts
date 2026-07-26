import { describe, expect, it } from "vitest"
import { parseSeasonEpisode } from "./seasonEpisode"

describe("parseSeasonEpisode", () => {
  it("parses the standard SxxEyy form", () => {
    expect(parseSeasonEpisode("Show.S01E02.mkv")).toEqual({ season: 1, episode: 2 })
  })

  it("is case-insensitive", () => {
    expect(parseSeasonEpisode("show s01e02")).toEqual({ season: 1, episode: 2 })
  })

  it("allows a separator between the season and episode numbers", () => {
    expect(parseSeasonEpisode("Show S01.E02")).toEqual({ season: 1, episode: 2 })
    expect(parseSeasonEpisode("Show S01_E02")).toEqual({ season: 1, episode: 2 })
    expect(parseSeasonEpisode("Show S01-E02")).toEqual({ season: 1, episode: 2 })
    expect(parseSeasonEpisode("Show S01 E02")).toEqual({ season: 1, episode: 2 })
  })

  it("allows a 3-digit episode number", () => {
    expect(parseSeasonEpisode("Show.S01E123.mkv")).toEqual({ season: 1, episode: 123 })
  })

  it("falls back to the NxNN form when SxxEyy isn't present", () => {
    expect(parseSeasonEpisode("Show 1x02")).toEqual({ season: 1, episode: 2 })
  })

  it("prefers the SxxEyy match when both forms are present", () => {
    expect(parseSeasonEpisode("Show S01E02 1x09")).toEqual({ season: 1, episode: 2 })
  })

  it("still finds a standalone NxNN marker alongside unrelated digit runs", () => {
    expect(parseSeasonEpisode("Movie.2020.1x02.finale")).toEqual({ season: 1, episode: 2 })
  })

  it("does not treat a resolution-like digit run as NxNN", () => {
    expect(parseSeasonEpisode("clip-1920x1080")).toBeNull()
  })

  it("returns null when neither form is present", () => {
    expect(parseSeasonEpisode("just_a_regular_filename.mp4")).toBeNull()
  })
})
