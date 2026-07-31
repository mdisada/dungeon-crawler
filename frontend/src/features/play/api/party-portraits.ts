// Party art for the live-play stage. Read straight from the client on purpose: both
// `characters_select_party` (the table) and `characters_storage_select_party` (the bucket) already
// let a member see the picked characters of everyone at their table, so the portraits never have
// to travel through GameState - which keeps the story pipeline out of the picture entirely.

import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 3600

/** The two crops live play asks for: the standing figure and the round head. */
export interface PartyPortrait {
  portrait: string | null
  token: string | null
}

// characters.images keys, newest scheme first (see CharacterImages in features/characters/types).
// `originalUrl` is deliberately absent from both chains: it still carries the chroma-green backdrop
// the keyer strips, and a green rectangle on stage is worse than an initial.
const PORTRAIT_KEYS = ['portraitUrl', 'baseUrl', 'fullbodyUrl'] as const
const TOKEN_KEYS = ['tokenUrl', 'avatarUrl', 'portraitUrl'] as const

function pick(images: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = images[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

/** Placeholder-mode assets and any absolute URL render as-is; only Storage paths need signing. */
const isDirectlyUsable = (path: string) =>
  path.startsWith('/') || path.startsWith('http') || path.startsWith('data:')

export async function fetchPartyPortraits(characterIds: string[]): Promise<Record<string, PartyPortrait>> {
  if (characterIds.length === 0) return {}

  const { data, error } = await supabase.from('characters').select('id, images').in('id', characterIds)
  if (error) throw error

  const chosen = new Map<string, PartyPortrait>()
  const paths = new Set<string>()
  for (const row of (data ?? []) as { id: string; images: Record<string, unknown> | null }[]) {
    const images = row.images ?? {}
    const entry = { portrait: pick(images, PORTRAIT_KEYS), token: pick(images, TOKEN_KEYS) }
    chosen.set(row.id, entry)
    for (const path of [entry.portrait, entry.token]) {
      if (path && !isDirectlyUsable(path)) paths.add(path)
    }
  }

  // One round trip for the whole party rather than one per crop per character.
  const signed = new Map<string, string>()
  if (paths.size > 0) {
    const { data: urls } = await supabase.storage
      .from('characters')
      .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS)
    for (const entry of urls ?? []) {
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl)
    }
  }

  const resolve = (path: string | null) =>
    path ? (isDirectlyUsable(path) ? path : (signed.get(path) ?? null)) : null

  return Object.fromEntries(
    [...chosen].map(([id, entry]) => [
      id,
      { portrait: resolve(entry.portrait), token: resolve(entry.token) },
    ]),
  )
}
