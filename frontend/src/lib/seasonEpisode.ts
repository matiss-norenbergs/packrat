export interface SeasonEpisode {
  season: number
  episode: number
}

// Matches the two naming conventions Jellyfin's own scraper recognizes:
// "S01E02" (any separator/case between the numbers) and the older "1x02"
// form. Tried in that order since SxxEyy is unambiguous while NxNN can
// collide with resolution-ish substrings in a filename.
export function parseSeasonEpisode(filename: string): SeasonEpisode | null {
  const seMatch = filename.match(/s(\d{1,2})[\s._-]*e(\d{1,3})/i)
  if (seMatch) {
    return { season: Number(seMatch[1]), episode: Number(seMatch[2]) }
  }

  const xMatch = filename.match(/(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)/i)
  if (xMatch) {
    return { season: Number(xMatch[1]), episode: Number(xMatch[2]) }
  }

  return null
}
