import { Label } from '@/components/ui/label'
import type { Cell } from '@rules/combat'
import { cn } from '@/lib/utils'

import { MAX_GRID, MIN_GRID } from '../types'
import type { EditorTool, MapImageFit, Spawns } from '../types'

const TOOLS: { value: EditorTool; label: string; hint: string }[] = [
  { value: 'pan', label: 'Pan', hint: 'Drag to move the map' },
  { value: 'obstacle', label: 'Obstacle', hint: 'Blocked cells' },
  { value: 'party', label: 'Party spawn', hint: 'Where party tokens start' },
  { value: 'enemy', label: 'Enemy spawn', hint: 'Where enemy tokens start' },
  { value: 'erase', label: 'Erase', hint: 'Clear a cell' },
]

const INPUT_CLASS = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm'

export interface MapGeometry {
  gridCols: number
  gridRows: number
  imageWidth: number | null
  imageHeight: number | null
  imageFit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
}

function aspectWarning(g: MapGeometry): string | null {
  if (!g.imageWidth || !g.imageHeight) return null
  const image = g.imageWidth / g.imageHeight
  const grid = g.gridCols / g.gridRows
  if (Math.abs(grid - image) / image <= 0.02) return null
  return g.imageFit === 'fill'
    ? "Grid aspect doesn't match the image, so 'Stretch to grid' will distort it. Adjust columns/rows or pick another fit."
    : "Grid aspect doesn't match the image; the current fit will crop or letterbox it."
}

interface MapToolsPanelProps {
  geometry: MapGeometry
  tool: EditorTool
  onTool: (tool: EditorTool) => void
  onCols: (n: number) => void
  onRows: (n: number) => void
  onImageFit: (fit: MapImageFit) => void
  idPrefix?: string
}

/** The shared grid/image-fit/tool controls used by both the /maps library and the location editor. */
export function MapToolsPanel({ geometry, tool, onTool, onCols, onRows, onImageFit, idPrefix = 'map' }: MapToolsPanelProps) {
  const warning = aspectWarning(geometry)
  const num = (handler: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value)
    if (Number.isFinite(n)) handler(n)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Grid (tiles)</span>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-cols`} className="text-xs">Columns</Label>
            <input id={`${idPrefix}-cols`} type="number" min={MIN_GRID} max={MAX_GRID} value={geometry.gridCols} onChange={num(onCols)} className={INPUT_CLASS} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-rows`} className="text-xs">Rows</Label>
            <input id={`${idPrefix}-rows`} type="number" min={MIN_GRID} max={MAX_GRID} value={geometry.gridRows} onChange={num(onRows)} className={INPUT_CLASS} />
          </div>
        </div>
        {geometry.imageWidth && geometry.imageHeight ? (
          <p className="text-xs text-muted-foreground">Image: {geometry.imageWidth} x {geometry.imageHeight} px</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-fit`} className="text-xs">Image fit</Label>
        <select id={`${idPrefix}-fit`} value={geometry.imageFit} onChange={(e) => onImageFit(e.target.value as MapImageFit)} className={INPUT_CLASS}>
          <option value="fill">Stretch to grid</option>
          <option value="cover">Cover (crop to fill)</option>
          <option value="contain">Contain (fit, letterbox)</option>
        </select>
      </div>

      {warning && <p className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">{warning}</p>}

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Tool</span>
        <div className="grid grid-cols-2 gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              title={t.hint}
              onClick={() => onTool(t.value)}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-xs',
                tool === t.value ? 'border-primary bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Obstacles {geometry.obstacles.length} &middot; Party {geometry.spawns.party.length} &middot; Enemy {geometry.spawns.enemy.length}
        </p>
      </div>
    </div>
  )
}
