import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import type { BattleMapRecord } from '../types'

interface MapControlsProps {
  mapsState: { maps: BattleMapRecord[]; status: 'loading' | 'ready' | 'error'; error: string | null }
  selectedMapId: string | null
  view: { gridOn: boolean; paintMode: boolean; measureMode: boolean }
  onSelectMap: (record: BattleMapRecord | null) => void
  onUpload: (name: string, file: File) => Promise<void>
  onViewChange: (patch: Partial<{ gridOn: boolean; paintMode: boolean; measureMode: boolean }>) => void
  onSaveObstacles: () => void
  canSaveObstacles: boolean
}

export function MapControls({
  mapsState, selectedMapId, view, onSelectMap, onUpload, onViewChange, onSaveObstacles, canSaveObstacles,
}: MapControlsProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.replace(/\.[^.]+$/, '') || 'Uploaded map'
    void onUpload(name, file)
    e.target.value = ''
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Map</h2>
      {mapsState.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {mapsState.error} (is the battle_maps migration applied?)
        </p>
      )}
      <Label htmlFor="lab-map-select" className="text-xs">Saved maps</Label>
      <select
        id="lab-map-select"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={selectedMapId ?? ''}
        onChange={(e) => onSelectMap(mapsState.maps.find((m) => m.id === e.target.value) ?? null)}
        disabled={mapsState.status !== 'ready'}
      >
        <option value="">No map (blank field)</option>
        {mapsState.maps.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-hidden onChange={handleFile} />
      <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
        Upload 1024x1024 image
      </Button>

      <div className="flex flex-col gap-1 pt-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={view.gridOn}
            onChange={(e) => onViewChange({ gridOn: e.target.checked, paintMode: false, measureMode: false })}
          />
          Grid (rules enforced)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={view.paintMode}
            disabled={!view.gridOn}
            onChange={(e) => onViewChange({ paintMode: e.target.checked, measureMode: false })}
          />
          Paint obstacles
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={view.measureMode}
            onChange={(e) => onViewChange({ measureMode: e.target.checked, paintMode: false })}
          />
          Measure (drag for feet)
        </label>
      </div>
      {canSaveObstacles && (
        <Button variant="outline" size="sm" className="w-full" onClick={onSaveObstacles}>
          Save obstacles to map
        </Button>
      )}
    </section>
  )
}
