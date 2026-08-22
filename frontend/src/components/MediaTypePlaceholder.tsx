import { Film, Image, Music } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MediaType } from "@/types/api"

// The fallback shown wherever a library item has no thumbnail (most
// commonly a ghost item — no file downloaded yet — but also a real item
// whose thumbnail was explicitly deleted) — a type-appropriate icon instead
// of a blank box, so a video vs. audio vs. image placeholder reads
// differently at a glance.
export function MediaTypePlaceholder({
  mediaType,
  className,
  iconClassName = "h-8 w-8",
}: {
  mediaType: MediaType | null | undefined
  className?: string
  iconClassName?: string
}) {
  const Icon = mediaType === "video" ? Film : mediaType === "image" ? Image : Music
  return (
    <div className={cn("flex h-full w-full items-center justify-center", className)}>
      <Icon className={cn(iconClassName, "text-muted-foreground/40")} />
    </div>
  )
}
