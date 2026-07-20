import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useTags } from "@/hooks/useTags"
import { mediaFileUrl } from "@/lib/api"
import type { LibraryItemEditFields } from "@/lib/libraryItemEdit"
import { cn, hashText } from "@/lib/utils"
import { ArtistSelect } from "./ArtistSelect"
import { TagInput } from "./TagInput"
import type { LibraryItem } from "@/types/api"

interface BulkEditLibraryItemRowProps {
  item: LibraryItem
  rowNumber: number
  fields: LibraryItemEditFields
  onChange: (patch: Partial<LibraryItemEditFields>) => void
}

// One item's full editable field set, always expanded (no Advanced toggle) —
// mirrors EditLibraryItemDialog's field-for-field, minus the read-only
// Resolution/Duration display fields. Alternating row shading (rowNumber %
// 2) mirrors BulkDownloadRow's same convention, since a long list of
// otherwise-identical bordered rows is hard to visually track.
export function BulkEditLibraryItemRow({ item, rowNumber, fields, onChange }: BulkEditLibraryItemRowProps) {
  const { data: allTags } = useTags()

  return (
    <div className={cn("space-y-3 rounded-md border p-3", rowNumber % 2 === 0 && "bg-muted/40")}>
      <div className="flex items-center gap-2">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="h-10 w-16 shrink-0 rounded object-cover"
            blurred={item.blurred}
            revealed={false}
            onToggleReveal={() => {}}
          />
        ) : (
          <div className="h-10 w-16 shrink-0 rounded bg-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.blurred ? hashText(item.title) : item.title}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 lg:col-span-2">
          <Label>Title</Label>
          <Input value={fields.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <div className="space-y-1 lg:col-span-2">
          <Label>Filename (without extension)</Label>
          <Input value={fields.filename} onChange={(e) => onChange({ filename: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Uploader</Label>
          <Input value={fields.uploader} onChange={(e) => onChange({ uploader: e.target.value })} />
        </div>

        <div className="space-y-1 lg:col-span-2">
          <Label>Artist</Label>
          <ArtistSelect value={fields.artistId} onValueChange={(v) => onChange({ artistId: v })} />
        </div>
        <div className="space-y-1">
          <Label>Year</Label>
          <Input
            type="number"
            placeholder="2024"
            value={fields.year}
            onChange={(e) => onChange({ year: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Season #</Label>
          <Input
            type="number"
            min="1"
            placeholder="1"
            value={fields.seasonNumber}
            onChange={(e) => onChange({ seasonNumber: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Sequence #</Label>
          <Input
            type="number"
            min="1"
            placeholder="1"
            value={fields.sequenceNumber}
            onChange={(e) => onChange({ sequenceNumber: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tags</Label>
          <TagInput
            value={fields.tags}
            onChange={(next) => onChange({ tags: next })}
            suggestions={allTags?.map((t) => t.name) ?? []}
          />
        </div>
        <div className="space-y-1">
          <Label>Original URL</Label>
          <Input
            placeholder="https://..."
            value={fields.originalUrl}
            onChange={(e) => onChange({ originalUrl: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea
          rows={2}
          className="max-h-24 overflow-y-auto"
          value={fields.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={`bulk-edit-nfo-${item.id}`}
          checked={fields.generateNfo}
          onCheckedChange={(v) => onChange({ generateNfo: v === true })}
        />
        <Label htmlFor={`bulk-edit-nfo-${item.id}`} className="font-normal">
          Generate NFO
        </Label>
      </div>
    </div>
  )
}
