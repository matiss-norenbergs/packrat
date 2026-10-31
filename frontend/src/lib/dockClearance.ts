// Classes that make a page footer clear the floating action dock (bottom-left, see FloatingActionDock) —
// only while the dock actually holds a button, via the `dock-occupied` variant in styles/globals.css. The
// pl-12 is the dock button (size-10) plus its gap; keep it here, never hard-coded in a page. Use them
// on the footer row and on its count label, next to the footer's own unconditional classes.
// `dock-occupied:md:min-h-0` (not a bare `md:min-h-0`) so it still beats `dock-occupied:min-h-9`.
export const DOCK_FOOTER_ROW = "dock-occupied:flex-wrap-reverse dock-occupied:gap-2"
export const DOCK_FOOTER_LABEL = "dock-occupied:flex dock-occupied:min-h-9 dock-occupied:items-center dock-occupied:pl-12 dock-occupied:md:min-h-0"
