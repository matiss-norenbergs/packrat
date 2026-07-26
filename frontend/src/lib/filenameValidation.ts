// Mirrors backend/internal/fsutil's unsafeFilenameChars — keep the two in
// sync. This is purely advisory: the backend sanitizer (fsutil.SanitizeFilename
// / SanitizeRelativePath) remains the actual source of truth for what gets
// stripped and saved, so a mismatch here would just mean a stale warning,
// never a security or correctness issue.
const UNSAFE_SEGMENT_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

// Same set minus "/", for text where a forward slash is a legitimate
// segment separator (a filename template's literal text, a folder path)
// rather than an unsafe character to flag.
const UNSAFE_PATH_CHARS = /[<>:"\\|?*\x00-\x1f]/g

// A {token} or {token:modifier} placeholder in a filename template — same
// shape as backend/internal/nametemplate's tokenPattern. Stripped before
// checking a template's literal text, since tokens get substituted with
// real (separately-safe) values at resolve time and shouldn't be flagged
// just for containing braces.
const TEMPLATE_TOKEN_PATTERN = /\{[a-z]+(?::[^}]+)?\}/gi

function distinctInvalidChars(value: string, pattern: RegExp): string[] {
  const matches = value.match(pattern) ?? []
  // Control characters aren't worth listing individually in a UI warning.
  return Array.from(new Set(matches)).filter((c) => c.charCodeAt(0) >= 0x20)
}

// Checks a single filename/title segment, where "/" itself is unsafe since
// it isn't expressing real nesting in this context.
export function invalidSegmentChars(value: string): string[] {
  return distinctInvalidChars(value, UNSAFE_SEGMENT_CHARS)
}

// Checks a filename template's literal text (tokens excluded) — "/" is a
// legitimate separator here.
export function invalidTemplateChars(value: string): string[] {
  return distinctInvalidChars(value.replace(TEMPLATE_TOKEN_PATTERN, ""), UNSAFE_PATH_CHARS)
}
