import { MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LibraryItem } from "@/types/api"
import { useLibraryItemActions, type LibraryItemAction } from "./libraryItemActions"

function ActionItems({ actions }: { actions: LibraryItemAction[] }) {
  return actions.map((a) =>
    "separator" in a ? (
      <DropdownMenuSeparator key={a.key} />
    ) : "items" in a ? (
      <DropdownMenuSub key={a.key}>
        <DropdownMenuSubTrigger>
          {a.icon} {a.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <ActionItems actions={a.items} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem key={a.key} variant={a.destructive ? "destructive" : undefined} disabled={a.disabled} onClick={a.onSelect}>
        {a.icon} {a.label}
      </DropdownMenuItem>
    ),
  )
}

// The "⋮" menu of a card, a folder-view row and the item page. The actions and their dialogs are defined once in
// libraryItemActions.tsx (the list view's right-click menu uses the same ones).
export function LibraryItemActionsMenu({ item }: { item: LibraryItem }) {
  const { actionsFor, host } = useLibraryItemActions(item)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <ActionItems actions={actionsFor(item)} />
        </DropdownMenuContent>
      </DropdownMenu>
      {host}
    </>
  )
}
