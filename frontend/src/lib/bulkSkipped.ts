/**
 * An item with a queued/running download is locked (the server refuses edits with a 409), so the bulk actions leave it out
 * and say so. `n` is the number left out; "" when none.
 */
export function skippedDownloadingNote(n: number): string {
  return n > 0 ? `${n} skipped, download in progress` : ""
}

/** `message` plus the skipped note in parentheses when any item was left out. */
export function withSkippedNote(message: string, skippedDownloading: number): string {
  const note = skippedDownloadingNote(skippedDownloading)
  return note ? `${message} (${note})` : message
}
