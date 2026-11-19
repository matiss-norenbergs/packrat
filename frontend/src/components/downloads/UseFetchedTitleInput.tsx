import { useEffect, useRef } from "react"
import { TextCursorInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface UseFetchedTitleInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string
  onChange: (value: string) => void
  /** Title from the link preview; the button only shows when this is non-empty. */
  previewTitle?: string | null
}

/**
 * Title override input with a button that copies the fetched preview title
 * into the field as editable text. The field is never pre-filled: empty still
 * means "no override".
 */
export function UseFetchedTitleInput({
  value,
  onChange,
  previewTitle,
  className,
  ...props
}: UseFetchedTitleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef(false)

  const showButton = !!previewTitle && value !== previewTitle

  // Runs after the controlled value has been committed, so the cursor lands
  // after the inserted text rather than where the old value ended.
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [value])

  function fillFromPreview() {
    if (!previewTitle) return
    pendingFocus.current = true
    onChange(previewTitle)
  }

  return (
    <div className="relative">
      <Input
        {...props}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(showButton && "pr-9", className)}
      />
      {showButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Use the fetched title"
              className="absolute inset-y-0 right-1 my-auto"
              onClick={fillFromPreview}
            >
              <TextCursorInput />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Use the fetched title</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
