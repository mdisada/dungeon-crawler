import type { Cell } from '@rules/combat'

/** One grid cell = 32 px when a map is rendered = 5 ft. Cells are always square. */
export const CELL_PX = 32

/** Grid bounds an authored map may use (mirrors the DB check constraint). */
export const MIN_GRID = 4
export const MAX_GRID = 128
export const DEFAULT_GRID_COLS = 32
export const DEFAULT_GRID_ROWS = 32

/** How the uploaded image maps onto the cols x rows grid area. */
export type MapImageFit = 'fill' | 'cover' | 'contain'

/** Default spawn squares per side, as [x,y] cells (same shape as obstacles). */
export interface Spawns {
  party: Cell[]
  enemy: Cell[]
}

/**
 * Editor pointer tool. 'pan' drags the viewport; the rest paint a cell role on click/drag.
 * Roles are mutually exclusive per cell (painting one clears the others).
 */
export type EditorTool = 'pan' | 'obstacle' | 'party' | 'enemy' | 'erase'

/** Suggested tags for the starter-map library (F09 SS3.4 tag-match genres). Free text is allowed. */
export const MAP_TAG_SUGGESTIONS = [
  'dungeon', 'cave', 'crypt', 'forest', 'interior', 'street', 'tavern', 'wilderness',
  'ship', 'temple', 'ruins', 'camp',
] as const

/** A saved battle map with its authored grid, image dims, fit, obstacles, spawns, and tags. */
export interface BattleMapRecord {
  id: string
  name: string
  path: string
  gridCols: number
  gridRows: number
  /** Intrinsic pixels of the uploaded image; null until read (older maps backfill on open). */
  imageWidth: number | null
  imageHeight: number | null
  imageFit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
  tags: string[]
  /** A public "starter" map (mig.isada@gmail.com's maps auto-publish; everyone can read them). */
  isPublic: boolean
  /** Whether the signed-in user owns this row (only owners may edit/delete). */
  isOwner: boolean
  url: string
}

/** Editable subset persisted by updateBattleMap. */
export interface BattleMapPatch {
  name?: string
  gridCols?: number
  gridRows?: number
  imageWidth?: number | null
  imageHeight?: number | null
  imageFit?: MapImageFit
  obstacles?: Cell[]
  spawns?: Spawns
  tags?: string[]
}

export const clampGrid = (n: number) => Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(n)))

/** Common VTT tile-export sizes; we pick the one that divides the image width most evenly. */
const TILE_GUESSES = [70, 72, 100, 128, 140, 150, 256]

/** Rows that keep cells square for the given cols and image aspect. */
export function rowsFromAspect(cols: number, width: number, height: number): number {
  if (width <= 0 || height <= 0) return cols
  return clampGrid(Math.round(cols * (height / width)))
}

/** Best-guess cols x rows for a freshly uploaded image (user confirms/corrects before it matters). */
export function suggestGrid(width: number, height: number): { cols: number; rows: number } {
  if (width <= 0) return { cols: DEFAULT_GRID_COLS, rows: DEFAULT_GRID_ROWS }
  let cols = clampGrid(Math.round(width / 70))
  let bestErr = Infinity
  for (const tile of TILE_GUESSES) {
    const candidate = Math.round(width / tile)
    if (candidate < MIN_GRID || candidate > MAX_GRID) continue
    const err = Math.abs(width - candidate * tile)
    if (err < bestErr) {
      bestErr = err
      cols = candidate
    }
  }
  return { cols, rows: rowsFromAspect(cols, width, height) }
}
