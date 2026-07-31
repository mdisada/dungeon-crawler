/**
 * Reads the tile count off a battle map by looking at the map itself.
 *
 * `suggestGrid` guesses from the image's dimensions, which works for VTT exports drawn at a known
 * tile size (70px, 140px...). A generated map has no such convention: the model rules its own grid
 * at whatever spacing it likes - measured across real generations, anywhere from 25 to 64 cells on
 * a 1024px image. Guessing from dimensions there is guessing.
 *
 * So this measures the ruling instead. Grid lines are darker than the floor and evenly spaced, so
 * the mean luminance per column is periodic, and autocorrelation finds the period. Two gates keep
 * it from locking onto floorboards or cobbles, which are also periodic:
 *
 *   - the correlation at the winning period must beat the median period's by a clear margin, and
 *   - the darkest phase within a cell must actually be darker than the cell interior, because a
 *     grid line is a dark line, not merely a repeating texture.
 *
 * Returns null when either gate fails, which is the caller's cue to fall back to `suggestGrid` and
 * let a person set it.
 */

import { clampGrid, MAX_GRID, MIN_GRID } from './types'

/**
 * Cell counts a generated battle map plausibly uses. Narrower than MIN_GRID..MAX_GRID on purpose:
 * below 8 the 'grid' is indistinguishable from composition, and above 64 from texture.
 */
const MIN_CELLS = 8
const MAX_CELLS = 64

export interface Bitmap {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface GridDetection {
  cols: number
  rows: number
  /** 0-1. Below ~0.3 the ruling is too faint to trust; the detector returns null well before that. */
  confidence: number
}

/**
 * Grey levels the ruling must sit below the cell interior. This single number is what separates a
 * map from a picture, and the separation is wide: measured over real generations, ruled maps came
 * in at 11.7-18.6 and everything without a usable ruling (a background photo, a map whose lines were
 * dissolved) at 0.3-2.6.
 */
const MIN_LINE_CONTRAST = 6

function luminanceProfiles({ data, width, height }: Bitmap): { columns: Float64Array; rows: Float64Array } {
  const columns = new Float64Array(width)
  const rows = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Rec. 601 luma, integer-ish: the exact weights do not matter, only that lines stay dark.
      const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      columns[x] += luma
      rows[y] += luma
    }
  }
  for (let x = 0; x < width; x++) columns[x] /= height
  for (let y = 0; y < height; y++) rows[y] /= width
  return { columns, rows }
}

/**
 * Mean luminance at each offset within a cell, used to find the darkest phase.
 *
 * Binned at the FRACTIONAL period. Rounding first looks harmless and is not: a 25.6px ruling binned
 * at 26 drifts 0.4px per cell, so by the far side of the image the line has walked through every
 * offset and the profile is flat - which reads as "no ruling here" exactly where there is one.
 */
function phaseProfile(profile: Float64Array, period: number): Float64Array {
  const bins = Math.max(2, Math.round(period))
  const sums = new Float64Array(bins)
  const counts = new Float64Array(bins)
  for (let i = 0; i < profile.length; i++) {
    const bin = Math.min(bins - 1, Math.floor(((i % period) / period) * bins))
    sums[bin] += profile[i]
    counts[bin] += 1
  }
  for (let b = 0; b < bins; b++) sums[b] /= Math.max(counts[b], 1)
  return sums
}

function detectAxis(profile: Float64Array): { period: number; confidence: number } | null {
  const size = profile.length
  if (size < MIN_CELLS * 4) return null

  const mean = profile.reduce((sum, v) => sum + v, 0) / size
  const dev = Float64Array.from(profile, (v) => v - mean)
  if (dev.reduce((sum, v) => sum + v * v, 0) <= 0) return null

  // Candidates are CELL COUNTS, not whole-pixel periods: 20 cells on a 1024px map is a 51.2px
  // spacing, and rounding that to 51 smears the correlation until a harmonic outscores it.
  const at = (i: number) => {
    const lo = Math.floor(i)
    const frac = i - lo
    return dev[lo] * (1 - frac) + dev[Math.min(lo + 1, size - 1)] * frac
  }
  const scores: { cells: number; period: number; score: number }[] = []
  for (let cells = MIN_CELLS; cells <= MAX_CELLS; cells++) {
    const period = size / cells
    let sum = 0
    let n = 0
    for (let i = 0; i + period < size - 1; i++) {
      sum += dev[i] * at(i + period)
      n++
    }
    if (n > 0) scores.push({ cells, period, score: sum / n })
  }
  if (scores.length === 0) return null

  // The peak, then two gates. Divisors of the true count also land on lines and so also correlate,
  // but on painted art the line positions wander by a pixel or two and the floor is never uniform,
  // which damps the harmonics below the fundamental. That is measured on real maps, not assumed:
  // this reads 25, 32, 32 and 32 cells off four generations whose spacing was measured independently.
  // (On a noise-free synthetic map the harmonics tie exactly and this picks the coarsest of them -
  // which is why the fixtures in the test carry jitter and mottling, as real art does.)
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  if (best.score <= 0) return null

  // A grid line is dark. A repeating texture need not be, and this is what separates them.
  const phases = phaseProfile(profile, best.period)
  const darkest = phases.reduce((a, b) => Math.min(a, b), Infinity)
  const brightest = phases.reduce((a, b) => Math.max(a, b), -Infinity)
  const contrast = brightest - darkest
  if (contrast < MIN_LINE_CONTRAST) return null

  // Contrast alone, since it is the only gate left and it is the honest measure of how legible the
  // ruling is: 6 is the floor, 20 and up is unambiguous.
  const confidence = Math.min(1, contrast / 20)
  return { period: best.period, confidence }
}

/**
 * Best-guess cols x rows read from the ruling drawn on the map. Null when there is no legible grid.
 *
 * One period governs both axes rather than measuring each independently, because a battle-map tile
 * is square - the same reason `rowsFromAspect` exists. It is also the more robust reading: on the
 * tavern map the horizontal bands of wall and floor beat the ruling on the row profile, so measured
 * alone that axis returned 128 cells. The axis with the clearer ruling wins and sets both.
 */
export function detectGrid(image: Bitmap): GridDetection | null {
  const { columns, rows } = luminanceProfiles(image)
  const across = detectAxis(columns)
  const down = detectAxis(rows)
  const winner = [across, down]
    .filter((candidate): candidate is { period: number; confidence: number } => candidate !== null)
    .reduce<{ period: number; confidence: number } | null>(
      (best, candidate) => (best === null || candidate.confidence > best.confidence ? candidate : best),
      null,
    )
  if (!winner) return null

  const cols = Math.round(image.width / winner.period)
  const rows_ = Math.round(image.height / winner.period)
  if (cols < MIN_GRID || cols > MAX_GRID || rows_ < MIN_GRID || rows_ > MAX_GRID) return null
  return { cols: clampGrid(cols), rows: clampGrid(rows_), confidence: winner.confidence }
}
