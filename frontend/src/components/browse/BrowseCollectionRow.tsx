import { BrowseRow } from "./BrowseRow"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { browseCollectionRowParams } from "@/lib/browseRows"

// One row of flat item tiles for a top-level collection with no browse-as-show collection anywhere
// in its subtree. It owns its (capped) query; BrowseRow renders nothing while empty or loading.
export function BrowseCollectionRow({ title, collectionIds }: { title: string; collectionIds: number[] }) {
  const { data } = useLibraryQuery(browseCollectionRowParams(collectionIds), collectionIds.length > 0)
  return <BrowseRow title={title} items={data?.items ?? []} />
}
