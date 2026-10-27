import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The single Save control every buffered tab ends with — button plus a
// status word ("No changes" / "Unsaved changes" / "Saved") so it's obvious
// at a glance whether anything you touched has actually been applied yet.
// Unrelated actions (Clear all now, Rescan Library Now) are NOT slotted in
// here — they aren't gated by Save, so they get their own row underneath
// instead of implying they're part of the same buffered-edit flow.
export function SaveRow({
  dirty,
  isPending,
  isSuccess,
  onSave,
}: {
  dirty: boolean
  isPending: boolean
  isSuccess: boolean
  onSave: () => void
}) {
  const status = dirty ? "Unsaved changes" : isSuccess ? "Saved" : "No changes"
  return (
    <div className="sticky -bottom-6 -mx-6 -mb-6 mt-auto flex items-center gap-3 border-t bg-card px-6 py-4">
      <Button onClick={onSave} disabled={!dirty || isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <span
        className={cn(
          "text-xs",
          dirty ? "text-warning" : isSuccess ? "text-success" : "text-muted-foreground",
        )}
      >
        {status}
      </span>
    </div>
  )
}
