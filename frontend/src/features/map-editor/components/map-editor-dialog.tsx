import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog'

import { MapEditorBody } from './map-editor-page'

interface MapEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
}

/** The map library as a large overlay - openable from the home page and anywhere else. */
export function MapEditorDialog({ open, onOpenChange, userId }: MapEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
          <DialogTitle className="text-sm font-semibold">Map editor</DialogTitle>
        </div>
        <div className="min-h-0 flex-1">
          <MapEditorBody userId={userId} />
        </div>
      </DialogPopup>
    </Dialog>
  )
}
