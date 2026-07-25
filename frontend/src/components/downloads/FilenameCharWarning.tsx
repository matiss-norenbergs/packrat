// Advisory-only heads-up shown under a filename-affecting input — the
// backend silently strips these characters when it actually saves the
// file, so this never blocks submission; it just tells the user up front
// what will change instead of them discovering it after the fact.
export function FilenameCharWarning({ chars }: { chars: string[] }) {
  if (chars.length === 0) return null
  return (
    <p className="text-xs text-amber-600 dark:text-amber-500">
      Not allowed in filenames, will be removed: {chars.map((c) => `"${c}"`).join(" ")}
    </p>
  )
}
