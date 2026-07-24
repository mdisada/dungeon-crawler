import { supabase } from '@/lib/supabase'
import type { Cell } from '@rules/combat'

import type { BattleMapRecord } from '../types'

const BUCKET = 'battle-maps'
const SIGNED_URL_TTL_S = 60 * 60

interface BattleMapRow {
  id: string
  name: string
  path: string
  obstacles: Cell[]
}

async function signedMapUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S)
  if (error || !data) throw new Error(`Map URL failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}

export async function listBattleMaps(): Promise<BattleMapRecord[]> {
  const { data, error } = await supabase
    .from('battle_maps')
    .select('id, name, path, obstacles')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`battle_maps load failed: ${error.message}`)
  const rows = (data ?? []) as BattleMapRow[]
  return Promise.all(rows.map(async (row) => ({ ...row, url: await signedMapUrl(row.path) })))
}

export async function uploadBattleMap(userId: string, name: string, file: File): Promise<BattleMapRecord> {
  const id = crypto.randomUUID()
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
  const path = `${userId}/${id}.${ext}`
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (upload.error) throw new Error(`Map upload failed: ${upload.error.message}`)
  const insert = await supabase.from('battle_maps').insert({ id, user_id: userId, name, path })
  if (insert.error) throw new Error(`battle_maps insert failed: ${insert.error.message}`)
  return { id, name, path, obstacles: [], url: await signedMapUrl(path) }
}

export async function saveMapObstacles(id: string, obstacles: Cell[]): Promise<void> {
  const { error } = await supabase.from('battle_maps').update({ obstacles }).eq('id', id)
  if (error) throw new Error(`Obstacle save failed: ${error.message}`)
}
