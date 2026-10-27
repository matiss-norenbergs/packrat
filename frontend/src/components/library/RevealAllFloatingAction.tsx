import { Eye, EyeOff } from "lucide-react"
import { FloatingAction } from "@/components/FloatingActionDock"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useHasPrivateContent } from "@/hooks/useHasPrivateContent"

// Opt-in per page. Hidden (not disabled) unless privacy is on and something
// private exists, since there'd be nothing for it to reveal.
export function RevealAllFloatingAction() {
  const hasPrivate = useHasPrivateContent()
  const { revealAll, toggleRevealAll } = useRevealAll()
  if (!hasPrivate) return null

  return (
    <FloatingAction
      icon={revealAll ? EyeOff : Eye}
      label={revealAll ? "Hide all private items" : "Reveal all private items"}
      active={revealAll}
      onClick={toggleRevealAll}
    />
  )
}
