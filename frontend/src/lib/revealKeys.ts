// RevealAllContext's reveal set is keyed by plain number and was built for
// library item ids (positive integers); Browse's show tiles negate collection
// ids (negative integers, see BrowseShowTile). Download ids are a third id
// space, so offset by half: every key this returns is a non-integer (1.5, 2.5,
// ...) and can therefore never equal either of the other two.
export function downloadRevealKey(downloadId: number): number {
  return downloadId + 0.5
}
