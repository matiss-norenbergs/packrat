import type { LibraryItem } from "@/types/api"

// One item in the ordered "sequenced" list. gapBefore is how many
// sequence-number slots are deliberately reserved immediately before this
// item — 0 means no gap. Gaps are NOT separate entries in the list; they're
// a plain field carried on the item that follows them, so drag-and-drop
// reordering (which just moves array elements) never needs special-case
// handling for gap "items" — a gap simply travels along with whichever item
// it's attached to.
export interface SequencedEntry {
  item: LibraryItem
  gapBefore: number
}

export interface ArrangementState {
  sequencedList: SequencedEntry[]
  leadingGap: number // reserved slots before the very first entry
  unsequencedList: LibraryItem[] // no sequenceNumber; not part of sequencedList until placed
}

export interface PositionEntry {
  position: number
  occupant: LibraryItem | null // null = this position falls inside a gap
}

// Invariant this whole module depends on: sequencedList[0].gapBefore must
// always be 0 — all "space before the first item" lives exclusively in
// leadingGap, otherwise computeDisplayNumbers would double-count it (a real
// bug caught during design review). Every mutating operation must funnel
// its result through this before returning.
export function normalizeHead(state: ArrangementState): ArrangementState {
  if (state.sequencedList.length === 0) return state
  const head = state.sequencedList[0]
  if (head.gapBefore === 0) return state
  return {
    ...state,
    leadingGap: state.leadingGap + head.gapBefore,
    sequencedList: [{ item: head.item, gapBefore: 0 }, ...state.sequencedList.slice(1)],
  }
}

// Builds the initial arrangement from a bulk selection. Items with a
// sequenceNumber are ordered ascending by it, with gaps inferred from the
// numeric distance between neighbors (and from 1 for the first item).
// Duplicate/inverted sequence numbers are possible (no DB uniqueness
// constraint on sequence_number) and would otherwise produce a negative
// gap — every gap is clamped to >= 0, which has the effect of silently
// renumbering duplicates to consecutive integers, matching the fact the
// data was already inconsistent. Items with no sequenceNumber become
// unsequencedList, ordered by download date, untouched until the user
// explicitly places one.
export function seedSequenceArrangement(items: LibraryItem[]): ArrangementState {
  const withSeq = [...items]
    .filter((i): i is LibraryItem & { sequenceNumber: number } => i.sequenceNumber != null)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const unsequencedList = items
    .filter((i) => i.sequenceNumber == null)
    .sort((a, b) => a.downloadedAt.localeCompare(b.downloadedAt))

  const sequencedList: SequencedEntry[] = withSeq.map((item, i) => {
    if (i === 0) return { item, gapBefore: 0 }
    const prev = withSeq[i - 1]
    return { item, gapBefore: Math.max(0, item.sequenceNumber - prev.sequenceNumber - 1) }
  })
  const leadingGap = withSeq.length > 0 ? Math.max(0, withSeq[0].sequenceNumber - 1) : 0

  return { sequencedList, leadingGap, unsequencedList }
}

// The number every row displays is purely a live consequence of position —
// nothing is ever stored per-item until Save. n starts at 1 + leadingGap;
// each entry consumes its own gapBefore worth of "skipped" numbers before
// taking the next one.
export function computeDisplayNumbers(leadingGap: number, list: SequencedEntry[]): number[] {
  let n = 1 + leadingGap
  const numbers: number[] = []
  for (const entry of list) {
    n += entry.gapBefore
    numbers.push(n)
    n += 1
  }
  return numbers
}

// Every integer position from 1 to the current max, paired with whatever
// currently occupies it (or null, inside a gap). Powers each row's
// "jump to position" select.
export function positionMap(leadingGap: number, list: SequencedEntry[]): PositionEntry[] {
  if (list.length === 0) return []
  const numbers = computeDisplayNumbers(leadingGap, list)
  const byNumber = new Map<number, LibraryItem>()
  list.forEach((entry, i) => byNumber.set(numbers[i], entry.item))
  const max = numbers[numbers.length - 1]
  const result: PositionEntry[] = []
  for (let p = 1; p <= max; p++) {
    result.push({ position: p, occupant: byNumber.get(p) ?? null })
  }
  return result
}

// Moves itemId (from either list) to targetPosition. The target's meaning
// (which entity/gap it refers to) is resolved BY IDENTITY against the
// ORIGINAL, pre-mutation arrangement — removing the mover can shift
// everything after it, so a raw position number would go stale mid-
// operation otherwise, and every gapBefore this function computes is
// derived directly from that original snapshot rather than from any
// intermediate (and therefore fragile) post-removal state.
//
// Landing on an occupied position: the mover always ends up EXACTLY on the
// clicked number, in both directions — whichever entries sat between the
// mover's old spot and the target shift by one slot to make room, exactly
// like a plain array move (dnd-kit's arrayMove produces the identical
// result for this branch). Concretely:
//   - Moving backward (mover was after the target): mover inherits the
//     target's current gapBefore, the target's own gapBefore resets to 0,
//     and the mover splices in immediately BEFORE it.
//   - Moving forward (mover was before the target): the mover gets a fresh
//     gapBefore of 0 and splices in immediately AFTER the target; whatever
//     was already the target's successor is left completely untouched, so
//     its gap survives unchanged. (Splicing "before" the target here — the
//     naive mirror of the backward case — would put the mover right back
//     where it started whenever it was already the target's immediate
//     predecessor, silently no-op'ing the two most common cases: swapping
//     with the very next occupied item via the down-arrow, or the mirrored
//     up-arrow case when the list is displayed in descending order.)
//
// Landing inside a gap: total missing-number count is always conserved,
// never silently collapsed or inflated. The gap's two original neighbors
// (before/after) are identified up front; if the mover happens to be one of
// them (a self-referential move — e.g. an item stepping backward into its
// own leading gap, or forward into the gap it already owns), the "other
// side" of the split is computed against that neighbor's *own* original
// neighbor instead, so the vacated slot the mover leaves behind survives as
// a brand new gap rather than being silently absorbed into a shift.
export function moveToPosition(state: ArrangementState, itemId: number, targetPosition: number): ArrangementState {
  // Bootstrap case: positionMap is empty when sequencedList is (nothing to
  // jump relative to yet), so this item just becomes the sole entry —
  // otherwise there'd be no way to ever place the very first item when a
  // selection is entirely unsequenced.
  if (state.sequencedList.length === 0) {
    const mover = state.unsequencedList.find((i) => i.id === itemId)
    if (!mover || targetPosition < 1) return state
    return {
      sequencedList: [{ item: mover, gapBefore: 0 }],
      leadingGap: targetPosition - 1,
      unsequencedList: state.unsequencedList.filter((i) => i.id !== itemId),
    }
  }

  const numbers = computeDisplayNumbers(state.leadingGap, state.sequencedList)
  const map = positionMap(state.leadingGap, state.sequencedList)
  const target = map.find((e) => e.position === targetPosition)
  if (!target) return state
  if (target.occupant?.id === itemId) return state

  const seqIdx = state.sequencedList.findIndex((e) => e.item.id === itemId)

  // --- Occupied target: mover always lands exactly on the clicked number. ---
  if (target.occupant) {
    const targetId = target.occupant.id
    const originalTargetIdx = state.sequencedList.findIndex((e) => e.item.id === targetId)
    const movingForward = seqIdx !== -1 && seqIdx < originalTargetIdx

    let sequencedList = state.sequencedList
    let unsequencedList = state.unsequencedList
    let mover: LibraryItem | undefined
    if (seqIdx !== -1) {
      mover = sequencedList[seqIdx].item
      const removedGap = sequencedList[seqIdx].gapBefore
      const newList = [...sequencedList.slice(0, seqIdx), ...sequencedList.slice(seqIdx + 1)]
      if (removedGap > 0 && newList.length > seqIdx) {
        newList[seqIdx] = { ...newList[seqIdx], gapBefore: newList[seqIdx].gapBefore + removedGap }
      }
      sequencedList = newList
    } else {
      mover = unsequencedList.find((i) => i.id === itemId)
      unsequencedList = unsequencedList.filter((i) => i.id !== itemId)
    }
    if (!mover) return state

    const idx = sequencedList.findIndex((e) => e.item.id === targetId)

    if (movingForward) {
      const newList = [...sequencedList]
      newList.splice(idx + 1, 0, { item: mover, gapBefore: 0 })
      return normalizeHead({ sequencedList: newList, leadingGap: state.leadingGap, unsequencedList })
    }

    const inherited = sequencedList[idx].gapBefore
    const newList = [...sequencedList]
    newList[idx] = { ...newList[idx], gapBefore: 0 }
    newList.splice(idx, 0, { item: mover, gapBefore: inherited })
    return normalizeHead({ sequencedList: newList, leadingGap: state.leadingGap, unsequencedList })
  }

  // --- Gap target: identify the gap's original before/after neighbors. ---
  let beforeId: number | null = null
  let afterIdxOriginal: number
  if (targetPosition <= state.leadingGap) {
    afterIdxOriginal = 0
  } else {
    afterIdxOriginal = numbers.findIndex((n) => n > targetPosition)
    if (afterIdxOriginal > 0) beforeId = state.sequencedList[afterIdxOriginal - 1].item.id
  }
  const afterId = state.sequencedList[afterIdxOriginal].item.id

  const moverIsBefore = seqIdx !== -1 && beforeId === itemId
  const moverIsAfter = seqIdx !== -1 && afterId === itemId

  // Mover's own gapBefore (or the new leadingGap, if it becomes the head).
  let moverGapBefore = 0
  let leadingGap = state.leadingGap
  if (beforeId === null) {
    leadingGap = targetPosition - 1
  } else {
    let predecessorNumber: number
    if (moverIsBefore) {
      // beforeEntity is the mover itself — use ITS original predecessor.
      const beforeIdxOriginal = afterIdxOriginal - 1
      predecessorNumber = beforeIdxOriginal > 0 ? numbers[beforeIdxOriginal - 1] : state.leadingGap
    } else {
      predecessorNumber = numbers[afterIdxOriginal - 1]
    }
    moverGapBefore = targetPosition - predecessorNumber - 1
  }

  // Whoever ends up immediately after the mover gets the remaining span of
  // the gap. Normally that's afterEntity — unless afterEntity IS the mover
  // (moving backward into its own gap), in which case the remainder must
  // attach to the mover's own original successor instead, so the slot the
  // mover vacates doesn't silently vanish.
  let remainderOwnerId: number | null = afterId
  let remainderNumber = numbers[afterIdxOriginal]
  if (moverIsAfter) {
    const grandAfterIdx = afterIdxOriginal + 1
    if (grandAfterIdx < state.sequencedList.length) {
      remainderOwnerId = state.sequencedList[grandAfterIdx].item.id
      remainderNumber = numbers[grandAfterIdx]
    } else {
      remainderOwnerId = null // mover was the last item — nothing to attach the remainder to
    }
  }
  const remainderGap = remainderOwnerId !== null ? remainderNumber - targetPosition - 1 : 0

  // Now actually remove the mover and apply the computed values.
  let sequencedList = state.sequencedList
  let unsequencedList = state.unsequencedList
  let mover: LibraryItem | undefined
  if (seqIdx !== -1) {
    mover = sequencedList[seqIdx].item
    sequencedList = [...sequencedList.slice(0, seqIdx), ...sequencedList.slice(seqIdx + 1)]
  } else {
    mover = unsequencedList.find((i) => i.id === itemId)
    unsequencedList = unsequencedList.filter((i) => i.id !== itemId)
  }
  if (!mover) return state

  if (remainderOwnerId !== null) {
    const ridx = sequencedList.findIndex((e) => e.item.id === remainderOwnerId)
    sequencedList[ridx] = { ...sequencedList[ridx], gapBefore: remainderGap }
  }

  if (beforeId === null) {
    sequencedList = [{ item: mover, gapBefore: 0 }, ...sequencedList]
  } else {
    const insertBeforeId = moverIsAfter ? remainderOwnerId : afterId
    if (insertBeforeId === null) {
      sequencedList = [...sequencedList, { item: mover, gapBefore: moverGapBefore }]
    } else {
      const iidx = sequencedList.findIndex((e) => e.item.id === insertBeforeId)
      sequencedList = [...sequencedList]
      sequencedList.splice(iidx, 0, { item: mover, gapBefore: moverGapBefore })
    }
  }

  return normalizeHead({ sequencedList, leadingGap, unsequencedList })
}

export type SequenceRenderNode =
  | { kind: "gap"; size: number; key: string; index: number } // index = the item this gap sits immediately before, in the canonical ascending sequencedList
  | { kind: "item"; entry: SequencedEntry; index: number } // index = this entry's position in the canonical ascending sequencedList

// Builds the list of nodes to render — gap markers interleaved with items —
// in either direction. "desc" is a pure display-order flip: every item
// keeps its actual sequence number and every gap keeps its actual size,
// nothing is recomputed. Concretely this reverses the flat
// [leadingGap, item0, item1.gapBefore, item1, ...] sequence as a whole
// (not just the items, and not the items-with-their-own-gapBefore-still-
// attached-before-them) — a gap conceptually sits *before* the item whose
// number it's short of, so flipping the whole reading direction puts that
// gap immediately *after* that item instead, which is what correctly moves
// the leading gap to the very end when reading highest-to-lowest.
export function buildRenderNodes(leadingGap: number, list: SequencedEntry[], direction: "asc" | "desc"): SequenceRenderNode[] {
  const nodes: SequenceRenderNode[] = []
  list.forEach((entry, i) => {
    nodes.push({
      kind: "gap",
      size: i === 0 ? leadingGap : entry.gapBefore,
      key: i === 0 ? "leading" : `gap-${entry.item.id}`,
      index: i,
    })
    nodes.push({ kind: "item", entry, index: i })
  })
  return direction === "desc" ? nodes.reverse() : nodes
}
