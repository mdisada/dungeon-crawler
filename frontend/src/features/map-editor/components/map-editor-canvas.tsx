import { useRef } from 'react'

import { cn } from '@/lib/utils'
import type { Cell } from '@rules/combat'

import { useMapViewport } from '../hooks/use-map-viewport'
import { CELL_PX } from '../types'
import type { EditorTool, MapImageFit, Spawns } from '../types'

const FIT_CLASS: Record<MapImageFit, string> = {
  fill: 'object-fill',
  cover: 'object-cover',
  contain: 'object-contain',
}

interface MapEditorCanvasProps {
  url: string | null
  cols: number
  rows: number
  imageFit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
  tool: EditorTool
  onPaint: (cell: Cell) => void
}

/**
 * Authoring canvas: pan/zoom over the map image with a cols x rows overlay, painting obstacle
 * and per-side spawn cells. No combat layers -- this is the map's author view, not the lab's.
 */
export function MapEditorCanvas({
  url, cols, rows, imageFit, obstacles, spawns, tool, onPaint,
}: MapEditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panEnabled = tool === 'pan'
  const { viewport, onWheel, onPointerDown, onPointerMove, onPointerUp, toMapPx } = useMapViewport(containerRef, panEnabled)
  const strokeRef = useRef<Set<string> | null>(null)

  const mapW = cols * CELL_PX
  const mapH = rows * CELL_PX

  function paintAt(clientX: number, clientY: number) {
    const at = toMapPx(clientX, clientY)
    if (!at) return
    const cell: Cell = [Math.floor(at.x / CELL_PX), Math.floor(at.y / CELL_PX)]
    if (cell[0] < 0 || cell[1] < 0 || cell[0] >= cols || cell[1] >= rows) return
    const key = `${cell[0]},${cell[1]}`
    if (strokeRef.current?.has(key)) return
    strokeRef.current?.add(key)
    onPaint(cell)
  }

  function surfacePointerDown(e: React.PointerEvent) {
    if (panEnabled) {
      onPointerDown(e)
      return
    }
    strokeRef.current = new Set()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    paintAt(e.clientX, e.clientY)
  }

  function surfacePointerMove(e: React.PointerEvent) {
    if (panEnabled) {
      onPointerMove(e)
      return
    }
    if (strokeRef.current) paintAt(e.clientX, e.clientY)
  }

  function surfacePointerUp(e: React.PointerEvent) {
    if (panEnabled) onPointerUp(e)
    else strokeRef.current = null
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full touch-none overflow-hidden bg-slate-950',
        panEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair',
      )}
      onWheel={onWheel}
      onPointerDown={surfacePointerDown}
      onPointerMove={surfacePointerMove}
      onPointerUp={surfacePointerUp}
    >
      <div
        className="relative origin-top-left"
        style={{ width: mapW, height: mapH, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
      >
        {url ? (
          <img src={url} alt="Battle map" className={cn('absolute inset-0 h-full w-full', FIT_CLASS[imageFit])} draggable={false} />
        ) : (
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-emerald-950 to-slate-900" />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(255 255 255 / 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.14) 1px, transparent 1px)',
            backgroundSize: `${CELL_PX}px ${CELL_PX}px`,
          }}
        />
        {obstacles.map(([x, y]) => (
          <div
            key={`o${x},${y}`}
            aria-hidden
            className="absolute bg-red-900/60 ring-1 ring-inset ring-red-500/40"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {spawns.party.map(([x, y]) => (
          <div
            key={`p${x},${y}`}
            aria-hidden
            className="absolute bg-emerald-500/30 ring-1 ring-inset ring-emerald-400/70"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
        {spawns.enemy.map(([x, y]) => (
          <div
            key={`e${x},${y}`}
            aria-hidden
            className="absolute bg-orange-500/30 ring-1 ring-inset ring-orange-400/70"
            style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
          />
        ))}
      </div>
    </div>
  )
}
