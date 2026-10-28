// RevealAllContext's reveal set is keyed by plain number and was built for
// library item ids (positive integers); Browse's show tiles negate collection
// ids (negative integers, see BrowseShowTile). Download ids are a third id
// space, so offset by half: every key this returns is a non-integer (1.5, 2.5,
// ...) and can therefore never equal either of the other two. The Collections
// info panel's cover is a fourth: collection ids offset by a quarter (1.25,
// 2.25, ...), non-integer and never ending in .5, so distinct from all three.
export function downloadRevealKey(downloadId: number): number {
  return downloadId + 0.5
}

export function collectionRevealKey(collectionId: number): number {
  return collectionId + 0.25
}
