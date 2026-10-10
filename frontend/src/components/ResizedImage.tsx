import { type ImgHTMLAttributes, useState } from "react"
import { type ResizeWidth, type ResizedImageSource, imageUrl, mediaFileUrl, resizedImageSrcSet } from "@/lib/api"

type ResizedImageProps = ResizedImageSource & {
  widths: readonly ResizeWidth[]
  sizes: string
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes">

// An <img> served as a resized WebP from GET /api/image via srcset, with the
// original file as the `src` fallback. If the resize request errors
// (unsupported source type, ffmpeg failure) the srcset is dropped so the
// browser loads the original and the image never goes blank. For surfaces that
// show arbitrary full-size files in small tiles; pre-generated tiers remain the
// right tool for library thumbnails (see docs/live-image-resize.md).
export function ResizedImage({ root, path, widths, sizes, ...props }: ResizedImageProps) {
  const [resizeFailed, setResizeFailed] = useState(false)
  return (
    <img
      {...props}
      src={root === "media" ? mediaFileUrl(path) : imageUrl(path)}
      srcSet={resizeFailed ? undefined : resizedImageSrcSet({ root, path, widths })}
      sizes={resizeFailed ? undefined : sizes}
      onError={() => setResizeFailed(true)}
    />
  )
}
