/**
 * The character image set is a chain, not four independent generations (F02, revised 2026-07-31):
 *
 *   original -> base -> portrait
 *                   \-> token
 *
 * - `original` is exactly what the model returned: full body, D&D style, near-black backdrop.
 * - `base` is `original` with the backdrop removed, so it is transparent everywhere but the figure.
 * - `portrait` and `token` are crops of `base`, which is why neither of them carries a rectangle of
 *   sky/floor around the character. The token then gets a flat fill the player picked behind it.
 *
 * Everything downstream reads a crop, so the removal only ever runs once per generation.
 */

import { keyOutBackdrop } from './chroma-key'

export const DEFAULT_TOKEN_BACKGROUND = '#1f2937'

/** Thrown when the generation came back without the flat green backdrop the cutout needs. */
export class BackdropNotKeyableError extends Error {
  constructor() {
    super('This image does not have the flat backdrop the cutout needs')
    this.name = 'BackdropNotKeyableError'
  }
}

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** Keeps a rect inside the source image, shifting first and shrinking only when it can't fit. */
export function clampRect(rect: CropRect, naturalW: number, naturalH: number): CropRect {
  const w = Math.min(rect.w, naturalW)
  const h = Math.min(rect.h, naturalH)
  const x = Math.min(Math.max(rect.x, 0), naturalW - w)
  const y = Math.min(Math.max(rect.y, 0), naturalH - h)
  return { x, y, w, h }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png')
  })
}

/**
 * Crops `img` and, when `backgroundColor` is given, paints that colour behind the crop. Without it
 * the transparency of the source survives into the output - which is what the portrait wants and
 * what the token deliberately does not.
 */
export function renderCrop(
  img: HTMLImageElement,
  rect: CropRect,
  outputW: number,
  outputH: number,
  backgroundColor?: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = outputW
  canvas.height = outputH
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, outputW, outputH)
  }
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, outputW, outputH)
  return canvasToBlob(canvas)
}

/**
 * Strips the generated backdrop, leaving the figure on transparency. See chroma-key.ts for how, and
 * why it is arithmetic rather than a matting model.
 *
 * Throws BackdropNotKeyableError when the image is not a green-screen generation - keying a picture
 * that has real scenery behind it would punch holes in it rather than cut it out.
 */
export async function cutOutBackdrop(source: Blob): Promise<{ blob: Blob; image: ImageData }> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0)

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (!keyOutBackdrop(image)) throw new BackdropNotKeyableError()
    ctx.putImageData(image, 0, 0)
    // The pixels come back with the blob because auto-framing needs the alpha channel, and
    // decoding the PNG again just to look at it would be pure waste.
    return { blob: await canvasToBlob(canvas), image }
  } finally {
    bitmap.close()
  }
}

export async function removeImageBackground(source: Blob): Promise<Blob> {
  const { blob } = await cutOutBackdrop(source)
  return blob
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image for cropping'))
    img.src = url
  })
}
