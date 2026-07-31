import { ChevronLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** Back out of live play, but only on purpose - a stray click must not drop someone mid-scene. */
export function LeaveTableDialog({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="Leave the table"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronLeftIcon className="size-3.5" />
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Leave the table?</DialogTitle>
        <DialogDescription>
          The session keeps running for everyone else. You can rejoin from your adventures at any time.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>Stay</DialogClose>
          <Button size="sm" onClick={onConfirm}>
            Leave
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
