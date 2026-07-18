import { useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { GRID_SIZE, moveCost } from '@rules/state'
import type { CombatState, TokenState } from '@rules/state'

import { sendMoveIntent } from '../api/session'
import { useMapViewport } from '../hooks/use-map-viewport'
import { usePlay } from '../hooks/use-play-context'
import { TurnBanner } from './turn-banner'

const CELL_PX = 32

/**
 * F06 SS3.1 tactical renderer: 1024x1024 map under a 32x32 grid, pan/zoom, controller-gated
 * token drags with optimistic move + server snap-back, movement-range highlight, initiative
 * ribbon, condition badges, obstacle shading.
 */
export function BattleMap({ combat }: { combat: CombatState }) {
  const { adventure, userId, role, isSpectator } = usePlay()
  const containerRef = useRef<HTMLDivElement>(null)
  const { viewport, onWheel, onPointerDown, onPointerMove, onPointerUp, toGrid } = useMapViewport(containerRef)
  // Optimistic position while the server round-trips; snapped back on rejection.
  const [optimistic, setOptimistic] = useState<{ tokenId: string; x: number; y: number } | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const dragRef = useRef<{ tokenId: string; pointerId: number } | null>(null)

  const isDm = role === 'dm'
  const activeToken = combat.tokens.find((t) => t.id === combat.activeTokenId)
  const canDrag = (token: TokenState) =>
    !isSpectator && (isDm || (token.controllerUserId === userId && token.id === combat.activeTokenId))

  const obstacleSet = useMemo(() => new Set(combat.obstacles.map(([x, y]) => `${x},${y}`)), [combat.obstacles])

  const rangeCells = useMemo(() => {
    if (!activeToken || !(isDm || activeToken.controllerUserId === userId)) return []
    const cells: { x: number; y: number }[] = []
    const budget = combat.economy.move
    for (let dx = -budget; dx <= budget; dx++) {
      for (let dy = -budget; dy <= budget; dy++) {
        const x = activeToken.x + dx
        const y = activeToken.y + dy
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue
        if (obstacleSet.has(`${x},${y}`)) continue
        if (moveCost(activeToken, { x, y }) <= budget) cells.push({ x, y })
      }
    }
    return cells
  }, [activeToken, combat.economy.move, isDm, userId, obstacleSet])

  async function commitMove(token: TokenState, to: { x: number; y: number }) {
    if (to.x === token.x && to.y === token.y) return
    setOptimistic({ tokenId: token.id, ...to })
    setRejection(null)
    try {
      const result = await sendMoveIntent(adventure.id, token.id, to)
      if (!result.ok) {
        setOptimistic(null)
        setRejection(result.reason ?? 'Move rejected')
        setTimeout(() => setRejection(null), 2500)
      }
      // On success the committed diff arrives over the channel; clear the overlay then.
      else setOptimistic(null)
    } catch {
      setOptimistic(null)
      setRejection('Move failed to send')
    }
  }

  function tokenPointerDown(e: React.PointerEvent, token: TokenState) {
    if (!canDrag(token)) return
    e.stopPropagation()
    dragRef.current = { tokenId: token.id, pointerId: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function tokenPointerMove(e: React.PointerEvent, token: TokenState) {
    if (dragRef.current?.tokenId !== token.id) return
    const grid = toGrid(e.clientX, e.clientY, CELL_PX)
    if (grid) setOptimistic({ tokenId: token.id, x: Math.floor(grid.x), y: Math.floor(grid.y) })
  }

  function tokenPointerUp(e: React.PointerEvent, token: TokenState) {
    if (dragRef.current?.tokenId !== token.id) return
    dragRef.current = null
    const grid = toGrid(e.clientX, e.clientY, CELL_PX)
    if (grid) void commitMove(token, { x: Math.floor(grid.x), y: Math.floor(grid.y) })
    else setOptimistic(null)
  }

  function tokenKeyDown(e: React.KeyboardEvent, token: TokenState) {
    if (!canDrag(token)) return
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    }
    const move = delta[e.key]
    if (!move) return
    e.preventDefault()
    void commitMove(token, { x: token.x + move[0], y: token.y + move[1] })
  }

  const positionOf = (token: TokenState) =>
    optimistic?.tokenId === token.id ? { x: optimistic.x, y: optimistic.y } : { x: token.x, y: token.y }

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <InitiativeRibbon combat={combat} />
      {activeToken && <TurnBanner token={activeToken} economy={combat.economy} />}
      {rejection && (
        <p role="alert" className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded bg-destructive px-3 py-1 text-sm text-white">
          {rejection}
        </p>
      )}

      <div
        ref={containerRef}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: GRID_SIZE * CELL_PX,
            height: GRID_SIZE * CELL_PX,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {combat.mapUrl ? (
            <img src={combat.mapUrl} alt="Battle map" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          ) : (
            <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-emerald-950 to-slate-900" />
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(255 255 255 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.12) 1px, transparent 1px)',
              backgroundSize: `${CELL_PX}px ${CELL_PX}px`,
            }}
          />
          {combat.obstacles.map(([x, y]) => (
            <div
              key={`${x},${y}`}
              aria-hidden
              className="absolute bg-red-900/40"
              style={{ left: x * CELL_PX, top: y * CELL_PX, width: CELL_PX, height: CELL_PX }}
            />
          ))}
          {rangeCells.map((cell) => (
            <div
              key={`r${cell.x},${cell.y}`}
              aria-hidden
              className="absolute bg-sky-400/15"
              style={{ left: cell.x * CELL_PX, top: cell.y * CELL_PX, width: CELL_PX, height: CELL_PX }}
            />
          ))}
          {combat.tokens.map((token) => {
            const pos = positionOf(token)
            return (
              <button
                key={token.id}
                type="button"
                aria-label={`${token.name} at column ${pos.x + 1}, row ${pos.y + 1}${canDrag(token) ? '. Use arrow keys to move' : ''}`}
                disabled={!canDrag(token)}
                onPointerDown={(e) => tokenPointerDown(e, token)}
                onPointerMove={(e) => tokenPointerMove(e, token)}
                onPointerUp={(e) => tokenPointerUp(e, token)}
                onKeyDown={(e) => tokenKeyDown(e, token)}
                className={cn(
                  'absolute z-10 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-sky-300',
                  token.allegiance === 'party' ? 'border-emerald-400' : token.allegiance === 'enemy' ? 'border-red-500' : 'border-amber-300',
                  token.id === combat.activeTokenId && 'shadow-[0_0_12px_4px_rgb(56_189_248/0.6)]',
                  canDrag(token) ? 'cursor-move' : 'cursor-default',
                )}
                style={{ left: pos.x * CELL_PX, top: pos.y * CELL_PX, width: CELL_PX, height: CELL_PX }}
              >
                {token.imageUrl ? (
                  <img src={token.imageUrl} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                    {token.name.charAt(0)}
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
        </div>
      </div>
    </div>
  )
}

function InitiativeRibbon({ combat }: { combat: CombatState }) {
  const byId = new Map(combat.tokens.map((t) => [t.id, t]))
  return (
    <ol className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 gap-1 rounded-full bg-black/70 px-3 py-1.5" aria-label="Initiative order">
      {combat.initiative.map(({ tokenId }) => {
        const token = byId.get(tokenId)
        if (!token) return null
        return (
          <li
            key={tokenId}
            title={token.name}
            className={cn(
              'flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold text-white',
              tokenId === combat.activeTokenId ? 'border-sky-300 shadow-[0_0_8px_2px_rgb(56_189_248/0.7)]' : 'border-white/30 opacity-70',
            )}
          >
            {token.imageUrl ? <img src={token.imageUrl} alt={token.name} className="h-full w-full object-cover" /> : token.name.charAt(0)}
          </li>
        )
      })}
    </ol>
  )
}
