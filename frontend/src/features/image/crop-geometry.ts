/**
 * Where the token and portrait sit inside a full-body image.
 *
 * One module because there are two ways to answer the question and they must agree: a person drags
 * a circle over the head (token-crop-tool), or the head is found from the cutout's own silhouette
 * (autoFrameFromSilhouette, used when the guide generates a cast and nobody is there to frame
 * fourteen of them). Both produce a token rect and derive the portrait from it identically, so
 * re-cropping an auto-framed NPC by hand moves the framing rather than changing the rules.
 *
 * Tuned against real generations (an elf ranger and a dwarf cleric, 2026-07-31), which is where
 * every constant below comes from - see the notes on each.
 */

import type { Bitmap } from './chroma-key'
import { clampRect, type CropRect } from './post-process'

/** Alpha at or above this counts as figure. Below it is backdrop or a fading edge. */
const SOLID_ALPHA = 128

/**
 * A row's width is its widest CONTIGUOUS run, not the distance between its outermost pixels. A bow
 * held across the body puts solid pixels at both edges of a row: measured as an extent, the elf's
 * skull reads 225px wide when it is 45.
 */
const ACCESSORY_RUN = 0.1 // runs narrower than this fraction of the widest are props, not anatomy

/** Rows used to establish head width, as a fraction of figure height. About one skull. */
const HEAD_BAND = 0.04

/** Scanning down, the silhouette widens sharply at the shoulders. */
const SHOULDER_WIDENING = 1.75

/** The head cannot plausibly occupy more of the figure than this, so stop looking. */
const MAX_HEAD_FRACTION = 0.3

/**
 * Token frame relative to head width. Width rather than height because a big beard trips the
 * shoulder test early - the dwarf's head measured 98px tall against the elf's 135, and sizing on
 * that cropped him at the nose. Head width is stable across both.
 */
const TOKEN_WIDTH_MARGIN = 2.2

/** Floor for the same frame, so a narrow face in a tall head still gets a square that contains it. */
const TOKEN_HEIGHT_MARGIN = 1.35

/** Headroom kept above the crown, as a fraction of the frame - enough for hair and a helmet plume. */
const HEAD_TOP_MARGIN = 0.05

export interface Silhouette {
  /** First row of the head - not of the figure, which may start at a bow tip or a helmet plume. */
  headTop: number
  headBottom: number
  bottom: number
  headWidth: number
  headCentreX: number
}

/**
 * The portrait is a 3:4 half-body: as wide as ~2.6 token frames, with the head in the upper fifth
 * and the frame running down past the torso. Shared with the manual tool so both paths agree.
 */
export function portraitRectFromToken(token: CropRect, naturalW: number, naturalH: number): CropRect {
  const headCentreX = token.x + token.w / 2
  const headCentreY = token.y + token.h / 2
  const w = Math.min(token.w * 2.6, naturalW)
  const h = w * (1024 / 768)
  return clampRect({ x: headCentreX - w / 2, y: headCentreY - h * 0.2, w, h }, naturalW, naturalH)
}

function widestRunPerRow({ data, width, height }: Bitmap): { width: number; centre: number }[] {
  const rows: { width: number; centre: number }[] = []
  for (let y = 0; y < height; y++) {
    let best = 0
    let bestCentre = 0
    let run = 0
    let start = 0
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= SOLID_ALPHA) {
        if (run === 0) start = x
        run++
        if (run > best) {
          best = run
          bestCentre = start + run / 2
        }
      } else {
        run = 0
      }
    }
    rows.push({ width: best, centre: bestCentre })
  }
  return rows
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Finds the head in a background-removed image. Returns null when there is no measurable figure,
 * which is the caller's cue to leave the crops empty rather than store a square of nothing.
 */
export function measureSilhouette(image: Bitmap): Silhouette | null {
  const rows = widestRunPerRow(image)
  let widest = 0
  let bottom = -1
  for (let y = 0; y < rows.length; y++) {
    if (rows[y].width > widest) widest = rows[y].width
    if (rows[y].width > 0) bottom = y
  }
  if (widest === 0) return null

  const headTop = rows.findIndex((row) => row.width >= widest * ACCESSORY_RUN)
  if (headTop < 0 || bottom - headTop < 8) return null

  const figureHeight = bottom - headTop + 1
  const bandEnd = Math.min(bottom, headTop + Math.max(8, Math.round(figureHeight * HEAD_BAND)))
  const headWidth = median(rows.slice(headTop, bandEnd + 1).map((row) => row.width))

  let headBottom = Math.min(bottom, headTop + Math.round(figureHeight * MAX_HEAD_FRACTION))
  for (let y = bandEnd + 1; y <= headBottom; y++) {
    if (rows[y].width > headWidth * SHOULDER_WIDENING) {
      headBottom = y
      break
    }
  }

  // Centre on the head's own runs: an arm held out to one side drags a figure-wide centre off the
  // face, and the median ignores the one row where a braid or a feather juts out.
  const centres = rows
    .slice(headTop, headBottom)
    .filter((row) => row.width > 0)
    .map((row) => row.centre)

  return { headTop, headBottom, bottom, headWidth, headCentreX: median(centres) }
}

/** Frames the token (and therefore the portrait) from the cutout alone. */
export function autoFrameFromSilhouette(
  image: Bitmap,
): { token: CropRect; portrait: CropRect; silhouette: Silhouette } | null {
  const silhouette = measureSilhouette(image)
  if (!silhouette) return null

  const size = Math.max(
    silhouette.headWidth * TOKEN_WIDTH_MARGIN,
    (silhouette.headBottom - silhouette.headTop) * TOKEN_HEIGHT_MARGIN,
    16,
  )
  const token = clampRect(
    {
      x: silhouette.headCentreX - size / 2,
      y: silhouette.headTop - size * HEAD_TOP_MARGIN,
      w: size,
      h: size,
    },
    image.width,
    image.height,
  )
  return { token, portrait: portraitRectFromToken(token, image.width, image.height), silhouette }
}
