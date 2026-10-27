import { createContext, useContext, useState, type ComponentType, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { LucideProps } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// The dock's container node, exposed to descendants so FloatingAction can
// portal into it. State-backed (not a ref) so actions that render before the
// container has mounted re-render once it exists.
const DockNodeContext = createContext<HTMLElement | null>(null)

// Mount once per layout, wrapping the layout's page content: it renders the
// children plus the fixed container that every <FloatingAction> below it
// portals into. The dock owns all positioning and stacking, so a feature only
// declares its button and never positions it.
//
// Sits bottom-left of the content area (md:left offsets past the 14rem
// sidebar, see Sidebar's w-56). z-40: above page content, below dialogs
// (z-50) and notice banners (z-[100]). The container ignores pointer events
// so it never blocks the page; only the buttons opt back in.
export function FloatingActionDock({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)

  return (
    <DockNodeContext.Provider value={node}>
      {children}
      <div
        ref={setNode}
        data-slot="floating-action-dock"
        className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-40 flex flex-col-reverse gap-2 empty:hidden md:left-[calc(14rem+1rem)]"
      />
    </DockNodeContext.Provider>
  )
}

interface FloatingActionProps {
  icon: ComponentType<LucideProps>
  /** Tooltip text and aria-label. */
  label: string
  onClick: () => void
  /** Visibly "on" state. */
  active?: boolean
  /** Stack position: lower values sit closer to the bottom. */
  order?: number
}

// Renders a round icon button into the nearest FloatingActionDock; renders
// nothing without one (e.g. layouts that don't mount a dock yet).
export function FloatingAction({ icon: Icon, label, onClick, active = false, order = 0 }: FloatingActionProps) {
  const node = useContext(DockNodeContext)
  if (!node) return null

  return createPortal(
    <div className="pointer-events-auto" style={{ order }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? "default" : "outline"}
            size="icon-lg"
            className="rounded-full shadow-md"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
          >
            <Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>,
    node,
  )
}
