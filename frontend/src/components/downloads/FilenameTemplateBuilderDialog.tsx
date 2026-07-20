import { useRef, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Wand2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  BUILDER_FIELDS,
  FIELD_LABELS,
  NUMERIC_FIELDS,
  TEXT_FIELDS,
  parseTemplate,
  resolveFilenameTemplatePreview,
  serializeTemplate,
  type FilenameTemplateVars,
  type TemplateElement,
  type TemplateField,
} from "@/lib/nametemplate"

// Radix Select doesn't allow an empty-string item value, so "none" is used
// as the sentinel for "no modifier" and translated back to "" on select.
const NO_MODIFIER = "none"

const JOIN_OPTIONS: { value: string; label: string }[] = [
  { value: NO_MODIFIER, label: "Keep spaces" },
  { value: ".", label: "Join with ." },
  { value: "_", label: "Join with _" },
  { value: "-", label: "Join with -" },
]

const PAD_OPTIONS: { value: string; label: string }[] = [
  { value: NO_MODIFIER, label: "No padding" },
  { value: "2", label: "Pad to 2 digits" },
  { value: "3", label: "Pad to 3 digits" },
]

// Placeholder values shown in the preview when the caller has no real
// metadata to preview against yet (e.g. building a collection's default
// template, which isn't tied to any one video).
const EXAMPLE_VARS: FilenameTemplateVars = {
  title: "Video Title",
  uploader: "Uploader Name",
  uploadDate: "20240102",
  artist: "Artist Name",
  year: "2024",
  season: "1",
  sequence: "3",
  collection: "Collection Name",
}

interface FilenameTemplateBuilderDialogProps {
  value: string
  onApply: (template: string) => void
  previewVars?: FilenameTemplateVars
}

export function FilenameTemplateBuilderDialog({ value, onApply, previewVars }: FilenameTemplateBuilderDialogProps) {
  const [open, setOpen] = useState(false)
  const [elements, setElements] = useState<TemplateElement[]>([])
  const idCounter = useRef(0)
  const nextId = () => {
    idCounter.current += 1
    return `builder-${idCounter.current}`
  }

  const handleOpenChange = (next: boolean) => {
    if (next) setElements(parseTemplate(value))
    setOpen(next)
  }

  const updateElement = (id: string, patch: Partial<TemplateElement>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? ({ ...el, ...patch } as TemplateElement) : el)))
  }

  const removeElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id))
  }

  const moveElement = (index: number, direction: -1 | 1) => {
    setElements((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const addToken = (field: TemplateField) => {
    setElements((prev) => [...prev, { id: nextId(), kind: "token", field, modifier: "" }])
  }

  const addSeparator = (text: string) => {
    setElements((prev) => [...prev, { id: nextId(), kind: "literal", text }])
  }

  const assembled = serializeTemplate(elements)
  const preview = resolveFilenameTemplatePreview(assembled, previewVars ?? EXAMPLE_VARS)

  const handleApply = () => {
    onApply(assembled)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => handleOpenChange(true)}
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Build a filename template visually</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Filename Template Builder</DialogTitle>
          <DialogDescription>
            Add fields and choose how each is formatted — how words within a field are joined, and
            how numbers are zero-padded. Add a "/" separator to create a subfolder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="max-h-[40vh] space-y-2 overflow-y-auto">
            {elements.length === 0 && (
              <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
                No fields yet — add one below.
              </p>
            )}
            {elements.map((el, index) => (
              <div key={el.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className="flex shrink-0 flex-col gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveElement(index, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Move down"
                    disabled={index === elements.length - 1}
                    onClick={() => moveElement(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {el.kind === "token" ? (
                  <>
                    <div className="w-36 shrink-0">
                      <Select
                        value={el.field}
                        onValueChange={(v) => updateElement(el.id, { field: v as TemplateField, modifier: "" })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUILDER_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      {TEXT_FIELDS.has(el.field) ? (
                        <Select
                          value={el.modifier || NO_MODIFIER}
                          onValueChange={(v) => updateElement(el.id, { modifier: v === NO_MODIFIER ? "" : v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {JOIN_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : NUMERIC_FIELDS.has(el.field) ? (
                        <Select
                          value={el.modifier || NO_MODIFIER}
                          onValueChange={(v) => updateElement(el.id, { modifier: v === NO_MODIFIER ? "" : v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAD_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="px-2 text-xs text-muted-foreground">No formatting options</p>
                      )}
                    </div>
                  </>
                ) : (
                  <Input
                    className="flex-1 font-mono"
                    placeholder="separator text, e.g. / or ."
                    value={el.text}
                    onChange={(e) => updateElement(el.id, { text: e.target.value })}
                  />
                )}

                <Button variant="ghost" size="icon-sm" title="Remove" onClick={() => removeElement(el.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Label className="text-xs text-muted-foreground">Add:</Label>
            {BUILDER_FIELDS.map((f) => (
              <Button key={f} type="button" variant="outline" size="sm" onClick={() => addToken(f)}>
                <Plus className="h-3 w-3" />
                {FIELD_LABELS[f]}
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addSeparator("/")}>
              <Plus className="h-3 w-3" />
              Subfolder (/)
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addSeparator(" - ")}>
              <Plus className="h-3 w-3" />
              Text
            </Button>
          </div>

          <div className="space-y-1 rounded-md border bg-muted/40 p-3">
            <p className="truncate font-mono text-xs">{assembled || "(empty)"}</p>
            <p className="truncate text-xs text-muted-foreground">
              Resolves to: <span className="font-mono">{preview || "(nothing yet)"}</span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
