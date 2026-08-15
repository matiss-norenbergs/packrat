// Builds the compact page-button sequence for a pagination footer — always
// page 1 and the last page, plus current-1/current/current+1, with an
// "ellipsis" marker filling any gap so the list never grows unbounded on a
// list with hundreds of pages.
export function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  const pages = new Set<number>([1, total, current])
  if (current - 1 >= 1) pages.add(current - 1)
  if (current + 1 <= total) pages.add(current + 1)
  const sorted = Array.from(pages).sort((a, b) => a - b)

  const out: (number | "ellipsis")[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("ellipsis")
    out.push(sorted[i])
  }
  return out
}
