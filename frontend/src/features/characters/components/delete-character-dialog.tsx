import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function DeleteCharacterDialog({
  characterName,
  onConfirm,
}: {
  characterName: string
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger className="rounded-md border px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10">
        Delete
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Delete {characterName || 'this character'}?</DialogTitle>
        <DialogDescription>This permanently removes the character and its images. This cannot be undone.</DialogDescription>
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
