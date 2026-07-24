import { Link } from 'react-router-dom'

import { Label } from '@/components/ui/label'
import { MAX_GRID, MIN_GRID } from '@/features/map-editor'
import type { BattleMapRecord, MapImageFit } from '@/features/map-editor'

interface GridSettings {
  cols: number
  rows: number
  imageFit: MapImageFit
}

interface MapControlsProps {
  mapsState: { maps: BattleMapRecord[]; status: 'loading' | 'ready' | 'error'; error: string | null }
  selectedMapId: string | null
  view: { gridOn: boolean; measureMode: boolean }
  grid: GridSettings
  onSelectMap: (record: BattleMapRecord | null) => void
  onViewChange: (patch: Partial<{ gridOn: boolean; measureMode: boolean }>) => void
  onGridChange: (patch: Partial<GridSettings>) => void
}

const INPUT_CLASS = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm'

export function MapControls({
  mapsState, selectedMapId, view, grid, onSelectMap, onViewChange, onGridChange,
}: MapControlsProps) {
  const mapSelected = selectedMapId !== null

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Map</h2>
        <Link to="/maps" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Manage maps
        </Link>
      </div>
      {mapsState.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {mapsState.error} (is the battle_maps migration applied?)
        </p>
      )}
      <Label htmlFor="lab-map-select" className="text-xs">Saved maps</Label>
      <select
        id="lab-map-select"
        className={INPUT_CLASS}
        value={selectedMapId ?? ''}
        onChange={(e) => onSelectMap(mapsState.maps.find((m) => m.id === e.target.value) ?? null)}
        disabled={mapsState.status !== 'ready'}
      >
        <option value="">No map (blank field)</option>
        {mapsState.maps.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      <div className="space-y-2 border-t border-border pt-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Grid &amp; size</h3>
        {mapSelected ? (
          <p className="text-xs text-muted-foreground">
            {grid.cols} x {grid.rows} tiles &middot; {grid.imageFit}. Set on the map &mdash;{' '}
            <Link to="/maps" className="underline-offset-2 hover:text-foreground hover:underline">edit in map editor</Link>.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="lab-grid-cols" className="text-xs">Columns</Label>
                <input
                  id="lab-grid-cols"
                  type="number"
                  min={MIN_GRID}
                  max={MAX_GRID}
                  value={grid.cols}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) onGridChange({ cols: n })
                  }}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lab-grid-rows" className="text-xs">Rows</Label>
                <input
                  id="lab-grid-rows"
                  type="number"
                  min={MIN_GRID}
                  max={MAX_GRID}
                  value={grid.rows}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) onGridChange({ rows: n })
                  }}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lab-image-fit" className="text-xs">Image fit</Label>
              <select
                id="lab-image-fit"
                value={grid.imageFit}
                onChange={(e) => onGridChange({ imageFit: e.target.value as MapImageFit })}
                className={INPUT_CLASS}
              >
                <option value="fill">Stretch to grid</option>
                <option value="cover">Cover (crop to fill)</option>
                <option value="contain">Contain (fit, letterbox)</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Blank-field grid. Upload and author real maps in the map editor.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 pt-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={view.gridOn}
            onChange={(e) => onViewChange({ gridOn: e.target.checked, measureMode: false })}
          />
          Grid (rules enforced)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={view.measureMode}
            onChange={(e) => onViewChange({ measureMode: e.target.checked })}
          />
          Measure (drag for feet)
        </label>
      </div>
    </section>
  )
}
