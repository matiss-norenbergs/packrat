import { BrowseTile } from "./BrowseTile"
import type { LibraryItem } from "@/types/api"

export function BrowseRow({ title, items }: { title: string; items: LibraryItem[] }) {
  if (items.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((item) => (
          <BrowseTile key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
