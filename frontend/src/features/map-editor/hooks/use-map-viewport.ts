// Pan/zoom viewport for the map editor canvas. Same math as the combat lab's use-lab-viewport
// (kept as a per-feature copy so map-editor never imports from combat-lab); `panEnabled` lets the
// paint tools claim the drag gesture instead of panning.

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface MapViewport {
  x: number
  y: number
  scale: number
}

/** The map content the viewport frames. `key` changes when a different map is loaded, which re-fits. */
export interface MapContent {
  width: number
  height: number
  key: string
}

const MIN_SCALE = 0.15
const MAX_SCALE = 3
const FIT_PADDING = 16

export function useMapViewport(
  containerRef: React.RefObject<HTMLDivElement | null>,
  panEnabled: boolean,
  content: MapContent,
) {
  const [viewport, setViewport] = useState<MapViewport>({ x: 0, y: 0, scale: 1 })
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)

  const { width, height, key } = content

  /** Centres the map and scales it to fill the container. Returns false while the container has no size yet. */
  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el || width <= 0 || height <= 0) return false
    const cw = el.clientWidth - FIT_PADDING * 2
    const ch = el.clientHeight - FIT_PADDING * 2
    if (cw <= 0 || ch <= 0) return false
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(cw / width, ch / height)))
    setViewport({ scale, x: (el.clientWidth - width * scale) / 2, y: (el.clientHeight - height * scale) / 2 })
    return true
  }, [containerRef, width, height])

  // Fit on load. A dialog's container can still be zero-sized on the first layout pass, so keep
  // watching until it has one; grid edits change `fit` but not `key`, and must not re-frame the map.
  const fittedKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || fittedKeyRef.current === key) return
    if (fit()) {
      fittedKeyRef.current = key
      return
    }
    const observer = new ResizeObserver(() => {
      if (!fit()) return
      fittedKeyRef.current = key
      observer.disconnect()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef, fit, key])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setViewport((v) => {
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const worldX = (cx - v.x) / v.scale
        const worldY = (cy - v.y) / v.scale
        return { scale: nextScale, x: cx - worldX * nextScale, y: cy - worldY * nextScale }
      })
    },
    [containerRef],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !panEnabled) return
      panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [panEnabled, viewport.x, viewport.y],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== e.pointerId) return
    setViewport((v) => ({ ...v, x: pan.originX + (e.clientX - pan.startX), y: pan.originY + (e.clientY - pan.startY) }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null
  }, [])

  /** Converts a client-space point into map-pixel coordinates. */
  const toMapPx = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      }
    },
    [containerRef, viewport],
  )

  return { viewport, onWheel, onPointerDown, onPointerMove, onPointerUp, toMapPx }
}
