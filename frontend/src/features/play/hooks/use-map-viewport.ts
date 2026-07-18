import { useCallback, useRef, useState } from 'react'

export interface MapViewport {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.3
const MAX_SCALE = 3

/**
 * Roll20-style pan (drag empty space) + zoom (wheel, centered on the cursor) for the tactical
 * map (F06 SS3.1). Pointer-event based so it works for mouse and touch alike.
 */
export function useMapViewport(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [viewport, setViewport] = useState<MapViewport>({ x: 0, y: 0, scale: 0.6 })
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setViewport((v) => {
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        // Keep the world point under the cursor fixed while scaling.
        const worldX = (cx - v.x) / v.scale
        const worldY = (cy - v.y) / v.scale
        return { scale: nextScale, x: cx - worldX * nextScale, y: cy - worldY * nextScale }
      })
    },
    [containerRef],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [viewport.x, viewport.y],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== e.pointerId) return
    setViewport((v) => ({ ...v, x: pan.originX + (e.clientX - pan.startX), y: pan.originY + (e.clientY - pan.startY) }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null
  }, [])

  /** Converts a client-space point into fractional grid coordinates. */
  const toGrid = useCallback(
    (clientX: number, clientY: number, cellPx: number): { x: number; y: number } | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      const worldX = (clientX - rect.left - viewport.x) / viewport.scale
      const worldY = (clientY - rect.top - viewport.y) / viewport.scale
      return { x: worldX / cellPx, y: worldY / cellPx }
    },
    [containerRef, viewport],
  )

  return { viewport, onWheel, onPointerDown, onPointerMove, onPointerUp, toGrid }
}
