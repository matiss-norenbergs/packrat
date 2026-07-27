export interface SequenceGapInfo {
  min: number
  max: number
  used: number[]
  missing: number[]
}

// Computes the used/missing sequence-number picture for a set of items —
// null when fewer than two of them carry a sequence number (nothing
// meaningful to report a "range" or "gap" for).
export function computeSequenceGaps(items: { sequenceNumber: number | null }[]): SequenceGapInfo | null {
  const used = Array.from(
    new Set(items.map((i) => i.sequenceNumber).filter((n): n is number => n != null)),
  ).sort((a, b) => a - b)
  if (used.length < 2) return null

  const min = used[0]
  const max = used[used.length - 1]
  const usedSet = new Set(used)
  const missing: number[] = []
  for (let n = min; n <= max; n++) {
    if (!usedSet.has(n)) missing.push(n)
  }
  return { min, max, used, missing }
}
