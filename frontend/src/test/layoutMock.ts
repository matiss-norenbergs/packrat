// jsdom has no layout: every element is 0x0, nothing scrolls, there is no ResizeObserver and `matchMedia` is missing. A
// windowed list needs all four to decide what to mount, so this fakes them just enough:
//   - `matchMedia("(min-width: …)")` answers from `setViewportWidth`, and fires `change` on the queries that flip;
//   - the scroll region (`[data-focus-region]`) is `viewportWidth` x `viewportHeight`; a measured row (`[data-index]`) is
//     `rowHeight(index)` tall; everything else stays 0;
//   - `scrollHeight` of the region follows the inline height of its first child (the windowed container);
//   - `ResizeObserver` reports an observed element once, when it starts observing (nothing resizes by itself);
//   - `scrollTo` / `scrollTop = n` on an element dispatch a `scroll` event, as a browser would.
// `installLayoutMock()` returns the controls and `restore()`, to call from afterEach.

export interface LayoutMockOptions {
  viewportWidth?: number
  viewportHeight?: number
  /** The measured height of the row with this `data-index` (default 100). */
  rowHeight?: (index: number) => number
}

export interface LayoutMock {
  setViewportWidth: (width: number) => void
  /** Scroll the region to `top` and fire the scroll event. */
  scrollTo: (el: Element, top: number) => void
  restore: () => void
}

export function installLayoutMock(options: LayoutMockOptions = {}): LayoutMock {
  let width = options.viewportWidth ?? 1280
  const height = options.viewportHeight ?? 600
  const rowHeight = options.rowHeight ?? (() => 100)

  const sizeOf = (el: Element) => {
    if (el.hasAttribute("data-focus-region")) return { width, height }
    const index = el.getAttribute("data-index")
    if (index != null && el.hasAttribute("data-first-item")) return { width, height: rowHeight(Number(index)) }
    return { width: 0, height: 0 }
  }

  // media queries
  type Mql = { query: string; matches: boolean; listeners: Set<() => void> }
  const queries = new Set<Mql>()
  const minWidthPx = (query: string) => {
    const m = /\(min-width:\s*([\d.]+)(px|rem)\)/.exec(query)
    return m ? Number(m[1]) * (m[2] === "rem" ? 16 : 1) : null
  }
  const evaluate = (query: string) => {
    const min = minWidthPx(query)
    return min != null && width >= min
  }
  const originalMatchMedia = window.matchMedia
  window.matchMedia = ((query: string) => {
    const mql: Mql & Record<string, unknown> = {
      query,
      media: query,
      matches: evaluate(query),
      listeners: new Set(),
      addEventListener: (_: string, l: () => void) => mql.listeners.add(l),
      removeEventListener: (_: string, l: () => void) => mql.listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }
    queries.add(mql)
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia

  // sizes
  const protos: [object, string, PropertyDescriptor | undefined][] = []
  const define = (proto: object, name: string, descriptor: PropertyDescriptor) => {
    protos.push([proto, name, Object.getOwnPropertyDescriptor(proto, name)])
    Object.defineProperty(proto, name, { configurable: true, ...descriptor })
  }
  define(HTMLElement.prototype, "offsetHeight", { get(this: HTMLElement) { return sizeOf(this).height } })
  define(HTMLElement.prototype, "offsetWidth", { get(this: HTMLElement) { return sizeOf(this).width } })
  define(Element.prototype, "clientHeight", { get(this: Element) { return sizeOf(this).height } })
  define(Element.prototype, "clientWidth", { get(this: Element) { return sizeOf(this).width } })
  // The scrollable height of the region: its content box (a windowed grid sets the total height inline) and the 4px padding.
  define(Element.prototype, "scrollHeight", {
    get(this: Element) {
      if (!this.hasAttribute("data-focus-region")) return sizeOf(this).height
      const inner = parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? "")
      return Math.max(height, Number.isFinite(inner) ? inner + 8 : 0)
    },
  })
  define(Element.prototype, "getBoundingClientRect", {
    value(this: Element) {
      const { width: w, height: h } = sizeOf(this)
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }
    },
  })

  const scrollTo = (el: Element, top: number) => {
    ;(el as HTMLElement).scrollTop = top
    el.dispatchEvent(new Event("scroll"))
  }
  define(Element.prototype, "scrollTo", {
    value(this: Element, arg?: ScrollToOptions | number) {
      const top = typeof arg === "object" ? arg.top : undefined
      if (top != null) scrollTo(this, top)
    },
  })

  // ResizeObserver
  const originalRO = globalThis.ResizeObserver
  class FakeResizeObserver {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(el: Element) {
      const { width: w, height: h } = sizeOf(el)
      const box = [{ inlineSize: w, blockSize: h }]
      this.callback([{ target: el, contentRect: { width: w, height: h }, borderBoxSize: box, contentBoxSize: box } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

  return {
    setViewportWidth(next) {
      width = next
      for (const mql of queries) {
        const matches = evaluate(mql.query)
        if (matches === mql.matches) continue
        mql.matches = matches
        for (const l of [...mql.listeners]) l()
      }
    },
    scrollTo,
    restore() {
      window.matchMedia = originalMatchMedia
      for (const [proto, name, descriptor] of protos.reverse()) {
        if (descriptor) Object.defineProperty(proto, name, descriptor)
        else delete (proto as Record<string, unknown>)[name]
      }
      globalThis.ResizeObserver = originalRO
    },
  }
}
