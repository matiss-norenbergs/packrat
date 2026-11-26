import { memo } from "react"
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
import { useSharedItemActions } from "./LibraryItemActionsProvider"

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

type ActionsFor = (item: LibraryItem) => LibraryItemAction[]

// Only mounted while the dropdown is open (Radix renders the content then), so the action list of a card is built when
// its menu opens, not on every render of every card.
function MenuItems({ item, actionsFor }: { item: LibraryItem; actionsFor: ActionsFor }) {
  return <ActionItems actions={actionsFor(item)} />
}

function ActionsDropdown({ item, actionsFor }: { item: LibraryItem; actionsFor: ActionsFor }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuItems item={item} actionsFor={actionsFor} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// No shared host around (the item page): the menu owns its actions and dialogs, bound to its item.
function OwnHostMenu({ item }: { item: LibraryItem }) {
  const { actionsFor, host } = useLibraryItemActions(item)
  return (
    <>
      <ActionsDropdown item={item} actionsFor={actionsFor} />
      {host}
    </>
  )
}

// The "⋮" menu of a card, a folder-view row and the item page. The actions and their dialogs are defined once in
// libraryItemActions.tsx (the list view's right-click menu uses the same ones). Inside a grid / folder view
// (LibraryItemActionsProvider) it renders only the dropdown and the shared host owns the dialogs; elsewhere it mounts its own.
export const LibraryItemActionsMenu = memo(function LibraryItemActionsMenu({ item }: { item: LibraryItem }) {
  const shared = useSharedItemActions()
  return shared ? <ActionsDropdown item={item} actionsFor={shared.actionsFor} /> : <OwnHostMenu item={item} />
})
