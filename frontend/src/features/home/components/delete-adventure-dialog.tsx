import { Trash2Icon } from 'lucide-react'

import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function DeleteAdventureDialog({
  adventureTitle,
  onConfirm,
}: {
  adventureTitle: string
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="Delete adventure"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon className="size-3.5" />
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Delete {adventureTitle || 'this adventure'}?</DialogTitle>
        <DialogDescription>
          This permanently removes the adventure, its guide, and all session data for every member. This cannot be
          undone.
        </DialogDescription>
        <DialogFooter>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Delete
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
