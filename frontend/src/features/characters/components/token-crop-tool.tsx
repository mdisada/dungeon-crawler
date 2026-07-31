import { useRef, useState } from 'react'

import { clampRect, DEFAULT_TOKEN_BACKGROUND, renderCrop, type CropRect } from '../image-pipeline'

const VIEWPORT = 240

export interface CropOutputs {
  token: Blob
  portrait: Blob
  tokenBackground: string
}

interface Transform {
  scale: number
  offsetX: number
  offsetY: number
}

interface TokenCropToolProps {
  /** The background-removed base image - both crops inherit its transparency. */
  sourceUrl: string
  onCrops: (crops: CropOutputs) => void
  isBusy: boolean
}

// F02 SS4 (revised per Phase 2 review): the user frames ONLY the token (head/face). The half-body
// portrait is derived from that rect - the token tells us where the head is, and the portrait
// extends downward from it.
export function TokenCropTool({ sourceUrl, onCrops, isBusy }: TokenCropToolProps) {
  const [transform, setTransform] = useState<Transform | null>(null)
  const [tokenBackground, setTokenBackground] = useState(DEFAULT_TOKEN_BACKGROUND)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const dragState = useRef<{ startX: number; startY: number; origin: Transform } | null>(null)

  function initTransform(img: HTMLImageElement) {
    if (transform) return
    // Frame the head: a "full body, head to toe, centered" figure puts the head near the top,
    // horizontally centered, spanning roughly a quarter of the image width. This now assumes a
    // ~square source (OpenRouter renders 1024x1024 since F12) rather than a 9:16 one, so the
    // default window is sized to the width and nudged just below the top edge.
    const headWindow = img.naturalWidth * 0.24
    const scale = VIEWPORT / headWindow
    const offsetX = (VIEWPORT - img.naturalWidth * scale) / 2
    const offsetY = -img.naturalHeight * scale * 0.06
    setTransform({ scale, offsetX, offsetY })
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!transform) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, origin: transform }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    setTransform({
      ...dragState.current.origin,
      offsetX: dragState.current.origin.offsetX + dx,
      offsetY: dragState.current.origin.offsetY + dy,
    })
  }

  function handlePointerUp() {
    dragState.current = null
  }

  function handleZoomChange(multiplier: number) {
    const img = imgRef.current
    if (!img || !transform) return
    const base = Math.max(VIEWPORT / img.naturalWidth, VIEWPORT / img.naturalHeight)
    setTransform({ ...transform, scale: base * multiplier })
  }

  async function handleSetImages() {
    const img = imgRef.current
    if (!img || !transform) return
    setError(null)

    // Viewport square -> source-space token rect (where the head is).
    const token: CropRect = clampRect(
      {
        x: -transform.offsetX / transform.scale,
        y: -transform.offsetY / transform.scale,
        w: VIEWPORT / transform.scale,
        h: VIEWPORT / transform.scale,
      },
      img.naturalWidth,
      img.naturalHeight,
    )
    const headCenterX = token.x + token.w / 2
    const headCenterY = token.y + token.h / 2

    // Half-body portrait (3:4): head sits in the upper fifth, frame extends down past the torso.
    const portraitW = Math.min(token.w * 2.6, img.naturalWidth)
    const portraitH = portraitW * (1024 / 768)
    const portrait = clampRect(
      { x: headCenterX - portraitW / 2, y: headCenterY - portraitH * 0.2, w: portraitW, h: portraitH },
      img.naturalWidth,
      img.naturalHeight,
    )

    try {
      const [tokenBlob, portraitBlob] = await Promise.all([
        // The token is the one image that gets a fill: it sits on a battle map, where a
        // see-through counter is unreadable. The portrait keeps its transparency.
        renderCrop(img, token, 256, 256, tokenBackground),
        renderCrop(img, portrait, 768, 1024),
      ])
      onCrops({ token: tokenBlob, portrait: portraitBlob, tokenBackground })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render crops')
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Frame the head for the map token</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Drag and zoom until the face fills the circle. The half-body portrait is derived from this
        framing automatically.
      </p>
      <div
        className="relative touch-none overflow-hidden rounded-md border bg-muted select-none"
        style={{ width: VIEWPORT, height: VIEWPORT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={sourceUrl}
          crossOrigin="anonymous"
          alt="Character portrait source for cropping"
          draggable={false}
          onLoad={(e) => initTransform(e.currentTarget)}
          style={
            transform
              ? {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  maxWidth: 'none',
                  transformOrigin: '0 0',
                  transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`,
                  backgroundColor: tokenBackground,
                }
              : { opacity: 0 }
          }
        />
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>

      <div className="mt-3 flex max-w-xs items-center gap-2">
        <label htmlFor="zoom-slider" className="text-xs text-muted-foreground">
          Zoom
        </label>
        <input
          id="zoom-slider"
          type="range"
          min={1}
          max={10}
          step={0.05}
          defaultValue={4}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          className="flex-1"
        />
      </div>

      <div className="mt-3 flex max-w-xs items-center gap-2">
        <label htmlFor="token-background" className="text-xs text-muted-foreground">
          Token background
        </label>
        <input
          id="token-background"
          type="color"
          value={tokenBackground}
          onChange={(e) => setTokenBackground(e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border bg-transparent"
        />
        <span className="text-xs text-muted-foreground">{tokenBackground}</span>
      </div>

      <button
        type="button"
        onClick={() => void handleSetImages()}
        disabled={!transform || isBusy}
        className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {isBusy ? 'Saving images…' : 'Set token & portrait'}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
