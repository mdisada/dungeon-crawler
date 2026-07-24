import { useRef, useState } from 'react'

const VIEWPORT = 240

export interface CropOutputs {
  token: Blob
  avatar: Blob
  portrait: Blob
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Transform {
  scale: number
  offsetX: number
  offsetY: number
}

// Keeps a rect inside the source image, shifting first and shrinking only when it can't fit.
function clampRect(rect: Rect, naturalW: number, naturalH: number): Rect {
  const w = Math.min(rect.w, naturalW)
  const h = Math.min(rect.h, naturalH)
  const x = Math.min(Math.max(rect.x, 0), naturalW - w)
  const y = Math.min(Math.max(rect.y, 0), naturalH - h)
  return { x, y, w, h }
}

function renderCrop(img: HTMLImageElement, rect: Rect, outputW: number, outputH: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = outputW
  canvas.height = outputH
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, outputW, outputH)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png')
  })
}

interface TokenCropToolProps {
  sourceUrl: string
  onCrops: (crops: CropOutputs) => void
  isBusy: boolean
}

// F02 SS4 (revised per Phase 2 review): the user frames ONLY the token (head/face). The avatar
// and half-body portrait crops are derived from that rect - the token tells us where the head
// is, the avatar is a slightly wider framing of it, and the portrait extends downward from it.
export function TokenCropTool({ sourceUrl, onCrops, isBusy }: TokenCropToolProps) {
  const [transform, setTransform] = useState<Transform | null>(null)
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
    const token: Rect = clampRect(
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

    // Avatar: the same head framing, pulled back ~35% for a bit of shoulder room.
    const avatarSize = token.w * 1.35
    const avatar = clampRect(
      { x: headCenterX - avatarSize / 2, y: headCenterY - avatarSize / 2, w: avatarSize, h: avatarSize },
      img.naturalWidth,
      img.naturalHeight,
    )

    // Half-body portrait (3:4): head sits in the upper fifth, frame extends down past the torso.
    const portraitW = Math.min(token.w * 2.6, img.naturalWidth)
    const portraitH = portraitW * (1024 / 768)
    const portrait = clampRect(
      { x: headCenterX - portraitW / 2, y: headCenterY - portraitH * 0.2, w: portraitW, h: portraitH },
      img.naturalWidth,
      img.naturalHeight,
    )

    try {
      const [tokenBlob, avatarBlob, portraitBlob] = await Promise.all([
        renderCrop(img, token, 256, 256),
        renderCrop(img, avatar, 256, 256),
        renderCrop(img, portrait, 768, 1024),
      ])
      onCrops({ token: tokenBlob, avatar: avatarBlob, portrait: portraitBlob })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render crops')
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Frame the head for the map token</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Drag and zoom until the face fills the circle. The avatar and half-body portrait are derived
        from this framing automatically.
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

      <button
        type="button"
        onClick={() => void handleSetImages()}
        disabled={!transform || isBusy}
        className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {isBusy ? 'Saving images…' : 'Set token, avatar & portrait'}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
