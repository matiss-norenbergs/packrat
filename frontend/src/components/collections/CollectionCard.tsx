import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { CollectionDialog } from "./CollectionDialog"
import { useDeleteCollection } from "@/hooks/useCollections"
import type { Collection } from "@/types/api"

export function CollectionCard({ collection }: { collection: Collection }) {
  const deleteCollection = useDeleteCollection()

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <CardTitle className="text-base">{collection.name}</CardTitle>
        <div className="flex gap-1">
          <CollectionDialog
            collection={collection}
            trigger={
              <Button variant="ghost" size="icon" title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{collection.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Existing downloads and library items in this collection become uncategorized —
                  they are not deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteCollection.mutate(collection.id)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Folder: {collection.rootPath}</p>
        <div className="flex gap-2">
          <Badge variant="outline">{collection.defaultDownloadType}</Badge>
          <Badge variant="outline">{collection.defaultQuality}</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
