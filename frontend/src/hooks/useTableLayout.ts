import { useCallback, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteTableLayout, fetchTableLayouts, saveTableLayout } from "@/lib/api"
import type { TableLayout, TableLayouts } from "@/types/api"

// Not under "auth": markLoggedOut and the 401 handler keep that key family and drop everything else,
// so a signed-out user's layouts never survive (same reason as preferencesQueryKey). The desktop
// reloads the app when it switches server, which empties the cache as well.
export const tableLayoutsQueryKey = ["tableLayouts"] as const

// All saved layouts of the account, fetched once and kept for the session (staleTime Infinity).
// AppLayout mounts it so the data is there before the first table renders; every useTableLayout
// reads the same cache entry. Only call from the authenticated layouts.
export function useTableLayouts() {
  return useQuery({ queryKey: tableLayoutsQueryKey, queryFn: fetchTableLayouts, staleTime: Infinity })
}

export interface TableLayoutOptions {
  /** Columns that exist; keys of other columns are ignored in `hidden`, `widths` and `sort`. Omit to keep all keys. */
  knownKeys?: readonly string[]
  /** Columns that may be hidden; narrows `hidden` further than `knownKeys` (a non-hideable column is never hidden). */
  hideableKeys?: readonly string[]
  /** The caller owns the working layout (e.g. a page that also needs it elsewhere); `onChange` receives every edit. */
  controlled?: { working: TableLayout; onChange: (layout: TableLayout) => void }
}

/** Order-independent, empty-field-free form used to compare layouts and to send them. */
export function normalizeTableLayout(layout: TableLayout, opts: Pick<TableLayoutOptions, "knownKeys" | "hideableKeys"> = {}): TableLayout {
  const known = opts.knownKeys ? new Set(opts.knownKeys) : null
  const hideable = opts.hideableKeys ? new Set(opts.hideableKeys) : known
  const out: TableLayout = { v: 1 }
  if (layout.sort && (!known || known.has(layout.sort.key))) out.sort = { key: layout.sort.key, dir: layout.sort.dir }
  const hidden = [...new Set(layout.hidden ?? [])].filter((k) => !hideable || hideable.has(k)).sort()
  if (hidden.length) out.hidden = hidden
  const widths = Object.entries(layout.widths ?? {})
    .filter(([k]) => !known || known.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (widths.length) out.widths = Object.fromEntries(widths)
  return out
}

function sameLayout(a: TableLayout, b: TableLayout) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface TableLayoutState {
  /** The account's saved layout for this table, null when none. */
  saved: TableLayout | null
  /** What Restore returns to: the saved layout, else the defaults. */
  baseline: TableLayout
  /** What the table shows now. Applied instantly, never saved automatically. */
  working: TableLayout
  setWorking: (next: TableLayout | ((prev: TableLayout) => TableLayout)) => void
  /** The working layout differs from the baseline (compared on the normalized form). */
  dirty: boolean
  hasSaved: boolean
  /** PUT the working layout. Toasts when the server answers; a second call while one is in flight is ignored. */
  save: () => Promise<void>
  /** working = baseline. No request, no toast. */
  restore: () => void
  /** DELETE the saved layout, then working = defaults. Same toast and in-flight rules as save. */
  clear: () => Promise<void>
}

/**
 * Working / saved / baseline layout of one table (or any list: it is not tied to DataTable). The working layout
 * lives in component state, so leaving the page and coming back starts from the baseline again. Until the user edits,
 * `working` simply is the baseline, so a saved layout that arrives late is adopted without overriding a change
 * made meanwhile.
 */
export function useTableLayout(tableId: string, defaults: TableLayout, opts: TableLayoutOptions = {}): TableLayoutState {
  const queryClient = useQueryClient()
  const { data: layouts } = useTableLayouts()
  const { knownKeys, hideableKeys, controlled } = opts

  // The key lists are usually rebuilt each render; key the memos on their content.
  const knownSig = knownKeys?.join("\0")
  const hideableSig = hideableKeys?.join("\0")
  const norm = useCallback(
    (l: TableLayout) => normalizeTableLayout(l, { knownKeys: knownSig?.split("\0"), hideableKeys: hideableSig?.split("\0") }),
    [knownSig, hideableSig],
  )

  const savedRaw = layouts?.[tableId]
  const saved = useMemo(() => (savedRaw ? norm(savedRaw) : null), [savedRaw, norm])
  const defaultsSig = JSON.stringify(norm(defaults))
  const normalizedDefaults = useMemo(() => JSON.parse(defaultsSig) as TableLayout, [defaultsSig])
  const baseline = saved ?? normalizedDefaults

  const [edited, setEdited] = useState<TableLayout | null>(null)
  const working = controlled ? controlled.working : (edited ?? baseline)

  const baselineRef = useRef(baseline)
  baselineRef.current = baseline
  const workingRef = useRef(working)
  workingRef.current = working
  const onChangeRef = useRef(controlled?.onChange)
  onChangeRef.current = controlled?.onChange
  const isControlled = controlled != null

  const setWorking = useCallback(
    (next: TableLayout | ((prev: TableLayout) => TableLayout)) => {
      const resolve = (prev: TableLayout) => (typeof next === "function" ? next(prev) : next)
      if (isControlled) onChangeRef.current?.(resolve(workingRef.current))
      else setEdited((prev) => resolve(prev ?? baselineRef.current))
    },
    [isControlled],
  )

  // Uncontrolled: dropping the edit makes working follow the baseline again. Controlled: the owner is told.
  const resetTo = useCallback(
    (target: TableLayout) => {
      if (isControlled) onChangeRef.current?.(target)
      else setEdited(null)
    },
    [isControlled],
  )

  const busy = useRef(false)
  const cacheLayout = (layout: TableLayout | null) => {
    if (!queryClient.getQueryData<TableLayouts>(tableLayoutsQueryKey)) {
      void queryClient.invalidateQueries({ queryKey: tableLayoutsQueryKey })
      return
    }
    queryClient.setQueryData<TableLayouts>(tableLayoutsQueryKey, (old) => {
      const next = { ...old }
      if (layout) next[tableId] = layout
      else delete next[tableId]
      return next
    })
  }

  const save = async () => {
    if (busy.current) return
    busy.current = true
    try {
      cacheLayout(await saveTableLayout(tableId, norm(workingRef.current)))
      toast.success("Layout saved")
    } catch (err) {
      toast.error(`Couldn't save the layout: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busy.current = false
    }
  }

  const clear = async () => {
    if (busy.current) return
    busy.current = true
    try {
      await deleteTableLayout(tableId)
      cacheLayout(null)
      resetTo(normalizedDefaults)
      toast.success("Layout cleared")
    } catch (err) {
      toast.error(`Couldn't clear the layout: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busy.current = false
    }
  }

  const restore = () => resetTo(baselineRef.current)

  return {
    saved,
    baseline,
    working,
    setWorking,
    dirty: !sameLayout(norm(working), norm(baseline)),
    hasSaved: saved != null,
    save,
    restore,
    clear,
  }
}
