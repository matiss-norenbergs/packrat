import { ShieldAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSecurityNotice } from "@/hooks/useTwoFactor"

// Shown once after sign-in when someone (or you) failed to log in since you last dismissed it.
// Floats at the top, like the other app notices, so it doesn't disturb any page's layout.
export function SecurityNotice() {
  const { notice, dismiss } = useSecurityNotice(true)
  if (!notice) return null

  const n = notice.failedAttempts
  const latest = notice.lastAttemptAt ? new Date(notice.lastAttemptAt).toLocaleString() : null

  return (
    <div
      role="status"
      className="fixed top-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        {n} failed login attempt{n === 1 ? "" : "s"} since your last login{latest ? ` (latest: ${latest})` : ""}.
      </span>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Dismiss" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
