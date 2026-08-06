import { Film, Music } from "lucide-react"
import { cn } from "@/lib/utils"

// The fallback shown wherever a library item has no thumbnail (most
// commonly a ghost item — no file downloaded yet — but also a real item
// whose thumbnail was explicitly deleted) — a type-appropriate icon instead
// of a blank box, so a video vs. an audio placeholder reads differently at
// a glance.
export function MediaTypePlaceholder({
  mediaType,
  className,
  iconClassName = "h-8 w-8",
}: {
  mediaType: "video" | "audio" | null | undefined
  className?: string
  iconClassName?: string
}) {
  const Icon = mediaType === "video" ? Film : Music
  return (
    <div className={cn("flex h-full w-full items-center justify-center", className)}>
      <Icon className={cn(iconClassName, "text-muted-foreground/40")} />
    </div>
  )
}
