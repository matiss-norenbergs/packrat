import { useEffect, useState } from "react"

// Persists a simple open/collapsed boolean (a right-side panel, an
// expand-all toggle, etc.) to localStorage under `key`, so it survives page
// reloads. Read once at mount; every change is written straight back.
export function usePersistedOpen(
  key: string,
  defaultValue: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key)
    return raw === null ? defaultValue : raw === "true"
  })

  useEffect(() => {
    localStorage.setItem(key, String(value))
  }, [key, value])

  return [value, setValue]
}
