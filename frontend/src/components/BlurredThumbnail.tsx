import { useSettings } from "@/hooks/useSettings"
import { cn } from "@/lib/utils"

// Literal class strings — Tailwind's build-time scanner only picks up whole
// strings it can find verbatim, not ones built from a template.
const BLUR_CLASS: Record<string, string> = {
  weak: "blur-sm",
  default: "blur-md",
  strong: "blur-2xl",
}

interface BlurredThumbnailProps {
  src: string
  alt?: string
  className?: string
  blurred: boolean
  revealed: boolean
  onToggleReveal: () => void
}

// Click-to-reveal: a blurred thumbnail can be temporarily un-blurred by
// clicking it, and clicking again re-blurs it. Reveal state is controlled by
// the parent so it can stay in sync with the item's display name, which
// reveals alongside the thumbnail on the same click. The underlying image is
// always fetched either way, this just controls what's visually shown.
export function BlurredThumbnail({ src, alt = "", className, blurred, revealed, onToggleReveal }: BlurredThumbnailProps) {
  const { data: settings } = useSettings()
  const blurClass = BLUR_CLASS[settings?.privacyBlurStrength ?? "default"] ?? BLUR_CLASS.default
  const showBlur = blurred && !revealed

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn(
        className,
        "select-none [-webkit-user-drag:none]",
        showBlur && [blurClass, "grayscale transition-[filter] duration-150 hover:grayscale-0"],
        blurred && "cursor-pointer",
      )}
      onClick={blurred ? onToggleReveal : undefined}
      title={blurred ? (revealed ? "Click to hide" : "Click to reveal") : undefined}
    />
  )
}
