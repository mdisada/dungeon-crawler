/**
 * The reusable shelf of location art: every background and map that gets generated is filed here
 * with its tags, and any location can pick one off it instead of paying to draw the same place
 * again (migration 20260731210000).
 *
 * Rows point at the SAME storage object the location uses - reusing a plate copies a path, not an
 * image. The storage policy in that migration is what makes another adventure able to read it.
 */

import { supabase } from '@/lib/supabase'
import type { LocationTag } from '../media-tags'

export type MediaKind = 'background' | 'map'

export interface LocationMedia {
  id: string
  name: string
  kind: MediaKind
  path: string
  tags: LocationTag[]
  gridCols: number | null
  gridRows: number | null
  prompt: string | null
  isPublic: boolean
  createdAt: string
}

interface Row {
  id: string
  name: string
  kind: MediaKind
  path: string
  tags: string[] | null
  grid_cols: number | null
  grid_rows: number | null
  prompt: string | null
  is_public: boolean
  created_at: string
}

const toMedia = (row: Row): LocationMedia => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  path: row.path,
  tags: (row.tags ?? []) as LocationTag[],
  gridCols: row.grid_cols,
  gridRows: row.grid_rows,
  prompt: row.prompt,
  isPublic: row.is_public,
  createdAt: row.created_at,
})

const COLUMNS = 'id, name, kind, path, tags, grid_cols, grid_rows, prompt, is_public, created_at'

/**
 * The shelf for one kind, newest first. `tags` narrows by overlap - a forest search returns
 * anything tagged forest, not only rows tagged exactly forest.
 */
export async function listLocationMedia({
  kind,
  tags = [],
  limit = 60,
}: {
  kind: MediaKind
  tags?: string[]
  limit?: number
}): Promise<LocationMedia[]> {
  let query = supabase.from('location_media').select(COLUMNS).eq('kind', kind)
  if (tags.length > 0) query = query.overlaps('tags', tags)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data as Row[]).map(toMedia)
}

/**
 * Files a freshly generated image. Best-effort by design: the art is already stored and pointed at
 * by the location, so a library insert that fails must not fail the generation that produced it.
 */
export async function addToLocationMedia(input: {
  adventureId: string
  name: string
  kind: MediaKind
  path: string
  tags: string[]
  gridCols?: number | null
  gridRows?: number | null
  prompt?: string | null
}): Promise<void> {
  const { data: session } = await supabase.auth.getUser()
  const userId = session.user?.id
  if (!userId) return

  const { error } = await supabase.from('location_media').insert({
    user_id: userId,
    adventure_id: input.adventureId,
    name: input.name,
    kind: input.kind,
    path: input.path,
    tags: input.tags,
    grid_cols: input.gridCols ?? null,
    grid_rows: input.gridRows ?? null,
    prompt: input.prompt ?? null,
  })
  if (error) console.warn('[location-media] could not file generated art:', error.message)
}
