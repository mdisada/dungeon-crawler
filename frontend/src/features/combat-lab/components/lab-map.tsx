import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { Cell } from '@rules/combat'

import type { MapImageFit } from '@/features/map-editor'

import { useLabViewport } from '../hooks/use-lab-viewport'
import { CELL_PX, FEET_PER_PX } from '../types'

const TOKEN_PX = CELL_PX

const FIT_CLASS: Record<MapImageFit, string> = {
  fill: 'object-fill',
  cover: 'object-cover',
  contain: 'object-contain',
}

export interface LabMapToken {
  id: string
  name: string
  side: 'party' | 'enemy'
  px: number
  py: number
  active: boolean
  selected: boolean
  draggable: boolean
  down: 'dead' | 'unconscious' | null
  /** Pre-redacted fill 0..1 (exact for party, quantized for enemies); null hides the bar. */
  hpFraction: number | null
  conditions: string[]
  /** Legal target in the current targeting mode - crosshair ring + confirm-on-click. */
  targetable: boolean
}

interface LabMapProps {
  mapUrl: string | null
  gridOn: boolean
  /** Grid dimensions in tiles; the map is cols x rows cells of CELL_PX. */
  cols: number
  rows: number
  /** How the uploaded image maps onto the grid area. */
  imageFit: MapImageFit
  obstacles: Cell[]
  paintMode: boolean
  measureMode: boolean
  /** True while an attack/spell is picking its target: non-targets dim, targets get the ring. */
  targetingActive: boolean
  /** True while placing an AoE: clicks set the aim cell, movement previews the template. */
  aimMode: boolean
  /** AoE template cells to shade (computed from the current aim). */
  templateCells: Cell[]
  tokens: LabMapToken[]
  rangeCells: Cell[]
  /** Dash-extended movement tier, rendered under rangeCells in amber. */
  dashCells: Cell[]
  /** Move preview: dashed path from `from` through `path`, ghost token at the end. */
  pendingPath: { from: Cell; path: Cell[] } | null
  /** Arbitrary content anchored at map-pixel coordinates (forecast card). */
  anchoredOverlay: { x: number; y: number; content: ReactNode } | null
  onTokenDrop: (id: string, px: number, py: number) => void
  onTokenClick: (id: string) => void
  onTokenHover: (id: string | null) => void
  onPaintCell: (cell: Cell) => void
  onAimHover: (cell: Cell | null) => void
  onAimClick: (cell: Cell) => void
}

/**
 * Adapted copy of the play feature's battle-map renderer (F09 SS9: no play imports): map image,
 * optional cols x rows grid, painted obstacles, movement highlights, draggable tokens, obstacle
 * painting, px->feet measuring, plus the combat-UI layers (targeting, move preview, overlay).
 */
export function LabMap({
  mapUrl, gridOn, cols, rows, imageFit, obstacles, paintMode, measureMode, targetingActive, aimMode,
  templateCells, tokens, rangeCells, dashCells, pendingPath, anchoredOverlay, onTokenDrop, onTokenClick,
  onTokenHover, onPaintCell, onAimHover, onAimClick,
}: LabMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panEnabled = !paintMode && !measureMode && !aimMode
  const { viewport, onWheel, onPointerDown, onPointerMove, onPointerUp, toMapPx } = useLabViewport(containerRef, panEnabled)
  const [drag, setDrag] = useState<{ id: string; px: number; py: number } | null>(null)
  const [measure, setMeasure] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null)
  const strokeRef = useRef<Set<string> | null>(null)

  const mapW = cols * CELL_PX
  const mapH = rows * CELL_PX
  const clampX = (v: number) => Math.min(mapW - TOKEN_PX, Math.max(0, v))
  const clampY = (v: number) => Math.min(mapH - TOKEN_PX, Math.max(0, v))
  const snap = (v: number) => (gridOn ? Math.floor((v + TOKEN_PX / 2) / CELL_PX) * CELL_PX : v)

  function paintAt(clientX: number, clientY: number) {
    const at = toMapPx(clientX, clientY)
    if (!at) return
    const cell: Cell = [Math.floor(at.x / CELL_PX), Math.floor(at.y / CELL_PX)]
    if (cell[0] < 0 || cell[1] < 0 || cell[0] >= cols || cell[1] >= rows) return
    const key = `${cell[0]},${cell[1]}`
    if (strokeRef.current?.has(key)) return
    strokeRef.current?.add(key)
    onPaintCell(cell)
  }

  function surfacePointerDown(e: React.PointerEvent) {
    if (paintMode) {
      strokeRef.current = new Set()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      paintAt(e.clientX, e.clientY)
    } else if (measureMode) {
      const at = toMapPx(e.clientX, e.clientY)
      if (at) setMeasure({ x0: at.x, y0: at.y, x1: at.x, y1: at.y })
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } else {
      onPointerDown(e)
    }
  }

  function aimCellAt(clientX: number, clientY: number): Cell | null {
    const at = toMapPx(clientX, clientY)
    if (!at) return null
    const cell: Cell = [Math.floor(at.x / CELL_PX), Math.floor(at.y / CELL_PX)]
    const within = cell[0] >= 0 && cell[1] >= 0 && cell[0] < cols && cell[1] < rows
    return within ? cell : null
  }

  function surfacePointerMove(e: React.PointerEvent) {
    if (paintMode) {
      if (strokeRef.current) paintAt(e.clientX, e.clientY)
    } else if (measureMode) {
      const at = toMapPx(e.clientX, e.clientY)
      if (at) setMeasure((m) => (m ? { ...m, x1: at.x, y1: at.y } : m))
    } else if (aimMode) {
      onAimHover(aimCellAt(e.clientX, e.clientY))
    } else {
      onPointerMove(e)
    }
  }

  function surfacePointerUp(e: React.PointerEvent) {
    if (paintMode) strokeRef.current = null
    else if (!measureMode && !aimMode) onPointerUp(e)
  }

  function surfaceClick(e: React.MouseEvent) {
    if (!aimMode) return
    const cell = aimCellAt(e.clientX, e.clientY)
    if (cell) onAimClick(cell)
  }

  function tokenPointerDown(e: React.PointerEvent, token: LabMapToken) {
    // Paint/measure act on the cell under the token, so let those events reach the surface.
    if (paintMode || measureMode) return
    // Otherwise a press on a token must not start a map pan, or pointer capture on the surface
    // steals the click (breaks click-to-target / click-to-inspect on non-draggable tokens).
    e.stopPropagation()
    if (!token.draggable) return
    dragRef.current = { id: token.id, pointerId: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: token.id, px: token.px, py: token.py })
  }

  function tokenPointerMove(e: React.PointerEvent, token: LabMapToken) {
    if (dragRef.current?.id !== token.id) return
    const at = toMapPx(e.clientX, e.clientY)
    if (at) setDrag({ id: token.id, px: snap(clampX(at.x - TOKEN_PX / 2)), py: snap(clampY(at.y - TOKEN_PX / 2)) })
  }

  function tokenPointerUp(e: React.PointerEvent, token: LabMapToken) {
    if (dragRef.current?.id !== token.id) return
    dragRef.current = null
    const at = toMapPx(e.clientX, e.clientY)
    setDrag(null)
    if (at) onTokenDrop(token.id, snap(clampX(at.x - TOKEN_PX / 2)), snap(clampY(at.y - TOKEN_PX / 2)))
  }

  function tokenKeyDown(e: React.KeyboardEvent, token: LabMapToken) {
    if (!token.draggable) return
    const step = gridOn ? CELL_PX : 8
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0],
    }
    const move = delta[e.key]
    if (!move) return
    e.preventDefault()
    onTokenDrop(token.id, clampX(token.px + move[0]), clampY(token.py + move[1]))
  }

  const measureFeet = measure
    ? Math.round(Math.hypot(measure.x1 - measure.x0, measure.y1 - measure.y0) * FEET_PER_PX)
    : 0

  const center = (cell: Cell) => `${cell[0] * CELL_PX + CELL_PX / 2},${cell[1] * CELL_PX + CELL_PX / 2}`
  const ghostCell = pendingPath?.path[pendingPath.path.length - 1] ?? null

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full touch-none overflow-hidden bg-slate-950',
        paintMode || measureMode || aimMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
      )}
      onWheel={onWheel}
      onPointerDown={surfacePointerDown}
      onPointerMove={surfacePointerMove}
      onPointerUp={surfacePointerUp}
      onClick={surfaceClick}
      onPointerLeave={() => aimMode && onAimHover(null)}
    >
      <div
        className="relative origin-top-left"
        style={{ width: mapW, height: mapH, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
      >
        {mapUrl ? (
          <img src={mapUrl} alt="Battle map" className={cn('absolute inset-0 h-full w-full', FIT_CLASS[imageFit])} draggable={false} />
        ) : (
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-emerald-950 to-slate-900" />
        )}
        {gridOn && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(255 255 255 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.12) 1px, transparent 1px)',
              backgroundSize: `${CELL_PX}px ${CELL_PX}px`,
            }}
          />
        )}
        {obstacles.map(([x, y]) => (
          <div
            key={`${x},${y}`}
            aria-hidden
            className="absolute bg-red-900/50"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {dashCells.map(([x, y]) => (
          <div
            key={`d${x},${y}`}
            aria-hidden
            className="absolute bg-amber-400/10"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {rangeCells.map(([x, y]) => (
          <div
            key={`r${x},${y}`}
            aria-hidden
            className="absolute bg-sky-400/15"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {templateCells.map(([x, y]) => (
          <div
            key={`t${x},${y}`}
            aria-hidden
            className="absolute bg-orange-500/30 ring-1 ring-inset ring-orange-400/50"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {pendingPath && ghostCell && (
          <>
            <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full">
              <polyline
                points={[center(pendingPath.from), ...pendingPath.path.map(center)].join(' ')}
                fill="none"
                stroke="rgb(56 189 248)"
                strokeWidth={3}
                strokeDasharray="6 5"
              />
            </svg>
            <span
              aria-hidden
              className="absolute z-10 rounded-full border-2 border-dashed border-sky-300 bg-sky-400/20"
              style={{ left: ghostCell[0] * CELL_PX, top: ghostCell[1] * CELL_PX, width: TOKEN_PX, height: TOKEN_PX }}
            />
          </>
        )}
        {measure && measureMode && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full">
            <line x1={measure.x0} y1={measure.y0} x2={measure.x1} y2={measure.y1} stroke="rgb(251 191 36)" strokeWidth={3} strokeDasharray="6 4" />
            <text x={(measure.x0 + measure.x1) / 2 + 8} y={(measure.y0 + measure.y1) / 2 - 8} fill="rgb(251 191 36)" fontSize={20} fontWeight={700}>
              {measureFeet} ft
            </text>
          </svg>
        )}
        {tokens.map((token) => {
          const pos = drag?.id === token.id ? drag : token
          return (
            <button
              key={token.id}
              type="button"
              aria-label={`${token.name}${token.down ? ` (${token.down})` : ''}${token.targetable ? '. Attack target' : ''}${token.draggable ? '. Drag or use arrow keys to move' : ''}`}
              onClick={() => onTokenClick(token.id)}
              onPointerEnter={() => onTokenHover(token.id)}
              onPointerLeave={() => onTokenHover(null)}
              onPointerDown={(e) => tokenPointerDown(e, token)}
              onPointerMove={(e) => tokenPointerMove(e, token)}
              onPointerUp={(e) => tokenPointerUp(e, token)}
              onKeyDown={(e) => tokenKeyDown(e, token)}
              className={cn(
                'absolute z-10 rounded-full border-2 focus-visible:ring-2 focus-visible:ring-sky-300',
                token.side === 'party' ? 'border-emerald-400' : 'border-red-500',
                token.active && 'shadow-[0_0_12px_4px_rgb(56_189_248/0.6)]',
                token.selected && 'ring-2 ring-amber-300',
                token.down === 'dead' && 'opacity-30 grayscale',
                token.down === 'unconscious' && 'opacity-50',
                token.targetable && 'cursor-crosshair ring-2 ring-red-400',
                targetingActive && !token.targetable && !token.active && 'opacity-40',
                aimMode && 'pointer-events-none',
                !token.targetable && (token.draggable ? 'cursor-move' : 'cursor-pointer'),
              )}
              style={{ left: pos.px, top: pos.py, width: TOKEN_PX, height: TOKEN_PX }}
            >
              <span className="flex h-full w-full items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                {token.name.charAt(0)}
              </span>
              {token.hpFraction !== null && (
                <span aria-hidden className="absolute -bottom-1.5 left-0 h-1 w-full overflow-hidden rounded bg-black/60">
                  <span
                    className={cn('block h-full', token.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')}
                    style={{ width: `${Math.round(token.hpFraction * 100)}%` }}
                  />
                </span>
              )}
              {token.conditions.length > 0 && (
                <span
                  title={token.conditions.join(', ')}
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-purple-500 ring-1 ring-white"
                />
              )}
            </button>
          )
        })}
        {anchoredOverlay && (
          <div className="pointer-events-none absolute z-30" style={{ left: anchoredOverlay.x, top: anchoredOverlay.y }}>
            {anchoredOverlay.content}
          </div>
        )}
      </div>
    </div>
  )
}
