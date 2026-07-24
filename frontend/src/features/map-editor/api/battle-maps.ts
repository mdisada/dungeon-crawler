import { supabase } from '@/lib/supabase'
import type { Cell } from '@rules/combat'

import { suggestGrid } from '../types'
import type { BattleMapPatch, BattleMapRecord, MapImageFit, Spawns } from '../types'

const BUCKET = 'battle-maps'
const SIGNED_URL_TTL_S = 60 * 60

interface BattleMapRow {
  id: string
  user_id: string
  name: string
  path: string
  grid_cols: number
  grid_rows: number
  image_width: number | null
  image_height: number | null
  image_fit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
  tags: string[] | null
  is_public: boolean
}

const ROW_COLUMNS =
  'id, user_id, name, path, grid_cols, grid_rows, image_width, image_height, image_fit, obstacles, spawns, tags, is_public'

async function signedMapUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S)
  if (error || !data) throw new Error(`Map URL failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}

async function toRecord(row: BattleMapRow, currentUserId: string): Promise<BattleMapRecord> {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gridCols: row.grid_cols,
    gridRows: row.grid_rows,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageFit: row.image_fit,
    obstacles: row.obstacles ?? [],
    spawns: row.spawns ?? { party: [], enemy: [] },
    tags: row.tags ?? [],
    isPublic: row.is_public,
    isOwner: row.user_id === currentUserId,
    url: await signedMapUrl(row.path),
  }
}

/** Reads an image file's intrinsic pixel size in the browser (0x0 if it fails to decode). */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 0, height: 0 })
    }
    img.src = url
  })
}

/** Same as readImageSize but from an already-hosted URL (used to backfill dims of older maps). */
export function readImageSizeUrl(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = url
  })
}

export async function listBattleMaps(currentUserId: string): Promise<BattleMapRecord[]> {
  // RLS returns the user's own maps + every public starter map (owner select OR is_public).
  const { data, error } = await supabase
    .from('battle_maps')
    .select(ROW_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`battle_maps load failed: ${error.message}`)
  return Promise.all(((data ?? []) as BattleMapRow[]).map((row) => toRecord(row, currentUserId)))
}

export async function uploadBattleMap(userId: string, name: string, file: File): Promise<BattleMapRecord> {
  const id = crypto.randomUUID()
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
  const path = `${userId}/${id}.${ext}`
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (upload.error) throw new Error(`Map upload failed: ${upload.error.message}`)

  const { width, height } = await readImageSize(file)
  const { cols, rows } = suggestGrid(width, height)
  const row = {
    id,
    user_id: userId,
    name,
    path,
    grid_cols: cols,
    grid_rows: rows,
    image_width: width || null,
    image_height: height || null,
  }
  // Read is_public back: the autopublish trigger flips it for the admin starter account.
  const insert = await supabase.from('battle_maps').insert(row).select('is_public, tags').single()
  if (insert.error) throw new Error(`battle_maps insert failed: ${insert.error.message}`)
  return {
    id, name, path, gridCols: cols, gridRows: rows, imageWidth: width || null, imageHeight: height || null,
    imageFit: 'fill', obstacles: [], spawns: { party: [], enemy: [] },
    tags: insert.data?.tags ?? [], isPublic: insert.data?.is_public ?? false, isOwner: true,
    url: await signedMapUrl(path),
  }
}

export async function updateBattleMap(id: string, patch: BattleMapPatch): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.gridCols !== undefined) row.grid_cols = patch.gridCols
  if (patch.gridRows !== undefined) row.grid_rows = patch.gridRows
  if (patch.imageWidth !== undefined) row.image_width = patch.imageWidth
  if (patch.imageHeight !== undefined) row.image_height = patch.imageHeight
  if (patch.imageFit !== undefined) row.image_fit = patch.imageFit
  if (patch.obstacles !== undefined) row.obstacles = patch.obstacles
  if (patch.spawns !== undefined) row.spawns = patch.spawns
  if (patch.tags !== undefined) row.tags = patch.tags
  const { error } = await supabase.from('battle_maps').update(row).eq('id', id)
  if (error) throw new Error(`Map save failed: ${error.message}`)
}

export async function deleteBattleMap(id: string, path: string): Promise<void> {
  const removed = await supabase.storage.from(BUCKET).remove([path])
  if (removed.error) throw new Error(`Map image delete failed: ${removed.error.message}`)
  const { error } = await supabase.from('battle_maps').delete().eq('id', id)
  if (error) throw new Error(`battle_maps delete failed: ${error.message}`)
}
