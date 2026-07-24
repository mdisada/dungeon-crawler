import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { MapEditorCanvas, MapToolsPanel, useBattleMaps } from '@/features/map-editor'
import type { BattleMapRecord } from '@/features/map-editor'

import { useMediaUrl } from '../hooks/use-media-url'
import { useLocationMap } from '../hooks/use-location-map'
import type { LocationRow } from '../types'

interface LocationMapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adventureId: string
  location: LocationRow
  userId: string
  onSaved: () => void
}

function StarterPicker({ userId, busy, onPick }: { userId: string; busy: boolean; onPick: (m: BattleMapRecord) => void }) {
  const { maps, status } = useBattleMaps(userId)
  return (
    <div className="space-y-1 rounded-lg border border-border p-2">
      <p className="text-xs font-medium text-muted-foreground">Seed from a map (copies its image + grid)</p>
      {status === 'loading' && <p className="text-xs text-muted-foreground">Loading maps...</p>}
      {status === 'ready' && maps.length === 0 && <p className="text-xs text-muted-foreground">No maps to seed from yet.</p>}
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {maps.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(m)}
              className="flex w-full items-center gap-2 rounded border border-transparent px-1 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
            >
              <img src={m.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              {!m.isOwner && m.isPublic && <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">starter</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Location-bound battle-map editor as a large dialog (map-pipeline): the same rich canvas + tools
 * as the /maps library, but bound to a location and persisted to locations.map. */
export function LocationMapDialog({ open, onOpenChange, adventureId, location, userId, onSaved }: LocationMapDialogProps) {
  const map = useLocationMap(adventureId, location, onSaved)
  const imageUrl = useMediaUrl(map.draft.imagePath)
  const fileRef = useRef<HTMLInputElement>(null)
  const [seeding, setSeeding] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="flex h-[90vh] w-[92vw] max-w-[92vw] flex-col overflow-hidden p-0">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <DialogTitle className="truncate text-sm font-semibold">Battle map — {location.name}</DialogTitle>
          {map.busy && <span className="text-xs text-muted-foreground">working…</span>}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <MapEditorCanvas
              url={imageUrl}
              cols={map.draft.gridCols}
              rows={map.draft.gridRows}
              imageFit={map.draft.imageFit}
              obstacles={map.draft.obstacles}
              spawns={map.draft.spawns}
              tool={map.tool}
              onPaint={map.paint}
            />
            {!map.draft.imagePath && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                  Generate, upload, or seed a map image to start.
                </p>
              </div>
            )}
          </div>

          <aside className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload map image"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void map.uploadImage(file)
                e.target.value = ''
              }}
            />
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="outline" disabled={map.busy} onClick={() => void map.generateImage()}>Generate</Button>
              <Button size="sm" variant="outline" disabled={map.busy} onClick={() => fileRef.current?.click()}>Upload</Button>
            </div>
            <Button size="sm" variant={seeding ? 'default' : 'outline'} onClick={() => setSeeding((s) => !s)}>
              {seeding ? 'Hide starter maps' : 'Seed from a starter map'}
            </Button>
            {seeding && (
              <StarterPicker
                userId={userId}
                busy={map.busy}
                onPick={(m) => {
                  void map.seedFromStarter(m)
                  setSeeding(false)
                }}
              />
            )}

            <MapToolsPanel
              geometry={map.draft}
              tool={map.tool}
              onTool={map.setTool}
              onCols={map.setCols}
              onRows={map.setRows}
              onImageFit={map.setImageFit}
              idPrefix="loc-map"
            />

            {map.error && <p role="alert" className="text-xs text-destructive">{map.error}</p>}

            <Button size="sm" className="mt-auto" disabled={!map.isDirty || map.busy} onClick={() => void map.save()}>
              {map.isDirty ? 'Save map' : 'Saved'}
            </Button>
          </aside>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
