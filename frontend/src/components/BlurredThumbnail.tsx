import { useState } from "react"
import { cn } from "@/lib/utils"

interface BlurredThumbnailProps {
  src: string
  alt?: string
  className?: string
  blurred: boolean
}

// Click-to-reveal: a blurred thumbnail can be temporarily un-blurred by
// clicking it, and clicking again re-blurs it. Purely local UI state — the
// underlying image is always fetched either way, this just controls what's
// visually shown.
export function BlurredThumbnail({ src, alt = "", className, blurred }: BlurredThumbnailProps) {
  const [revealed, setRevealed] = useState(false)
  const showBlur = blurred && !revealed

  return (
    <img
      src={src}
      alt={alt}
      className={cn(className, showBlur && "blur-md", blurred && "cursor-pointer")}
      onClick={blurred ? () => setRevealed((v) => !v) : undefined}
      title={blurred ? (revealed ? "Click to hide" : "Click to reveal") : undefined}
    />
  )
}
