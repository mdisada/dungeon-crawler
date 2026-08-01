// What to synthesize: the content address of each chunk, and who is responsible for producing it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const BUCKET = 'narration-audio'
// Long enough to outlive a session, since a URL is signed once when the clip is made and never
// refreshed - the client holds it for as long as the line stays on screen.
const SIGNED_URL_TTL_SECONDS = 8 * 60 * 60

/**
 * cached   - already on disk; the URL rides back in the response and costs nothing
 * claimed  - this invocation synthesizes it
 * awaiting - another invocation claimed it first; its broadcast will serve us too
 * mirror   - identical text to an earlier chunk in this same line, so it plays that chunk's clip
 */
export type ChunkStatus = 'cached' | 'claimed' | 'awaiting' | 'mirror'

export interface ChunkPlan {
  index: number
  text: string
  cacheKey: string
  storagePath: string
  status: ChunkStatus
  /** Set only for `cached` - the client can play it without waiting for any broadcast. */
  url: string | null
  /** For a claimed chunk: the later indices in this line whose text is identical to it. */
  mirrors: number[]
}

export interface SynthesisContext {
  service: SupabaseClient
  /** Adventure id, or `lab-{user id}`. First path segment, and half the uniqueness key. */
  scope: string
  adventureId: string | null
  ownerId: string
  lineId: string
  model: string
  referenceId: string | null
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Content address for one chunk. Voice and engine are in the key alongside the text, so switching
 * either produces a miss rather than serving audio in the wrong voice, and editing a line's text
 * can never serve the old reading.
 */
export function cacheKeyFor(ctx: SynthesisContext, text: string): Promise<string> {
  return sha256Hex(`${ctx.model}\n${ctx.referenceId ?? 'default'}\n${text}`)
}

export async function signedUrl(ctx: SynthesisContext, path: string): Promise<string | null> {
  const { data, error } = await ctx.service.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    console.error('narration signing failed', error)
    return null
  }
  return data.signedUrl
}

/** Drops any existing clip for these keys, so a lab run measures synthesis rather than the cache. */
export async function bustCache(ctx: SynthesisContext, cacheKeys: string[]): Promise<void> {
  const { data } = await ctx.service
    .from('narration_clips')
    .delete()
    .eq('scope', ctx.scope)
    .in('cache_key', cacheKeys)
    .select('storage_path')
  const paths = (data ?? []).map((row) => row.storage_path as string)
  if (paths.length > 0) await ctx.service.storage.from(BUCKET).remove(paths)
}

async function claim(
  ctx: SynthesisContext,
  cacheKey: string,
): Promise<{ status: ChunkStatus; url: string | null }> {
  const storagePath = `${ctx.scope}/${cacheKey}.mp3`
  const { data, error } = await ctx.service.rpc('claim_narration_clip', {
    p_scope: ctx.scope,
    p_cache_key: cacheKey,
    p_storage_path: storagePath,
    p_adventure_id: ctx.adventureId,
    p_owner_id: ctx.ownerId,
    p_model: ctx.model,
    p_voice_ref: ctx.referenceId,
  })
  if (error) throw new Error(`claim failed: ${error.message}`)

  const row = (data as { claimed: boolean; ready: boolean; path: string | null }[] | null)?.[0]
  if (row?.claimed) return { status: 'claimed', url: null }
  if (row?.ready) return { status: 'cached', url: await signedUrl(ctx, row.path ?? storagePath) }
  return { status: 'awaiting', url: null }
}

/**
 * Decides, for every chunk, whether this invocation synthesizes it, already has it, or should
 * leave it to whoever claimed it first. Runs before the response, so the caller learns immediately
 * which chunks are already playable.
 */
export async function planChunks(ctx: SynthesisContext, texts: string[]): Promise<ChunkPlan[]> {
  const keys = await Promise.all(texts.map((text) => cacheKeyFor(ctx, text)))

  // Two boxes with identical text are one clip, so only the first of them is claimed - claiming
  // the second would return `awaiting` against our own reservation and that box would never be
  // told about audio that already exists.
  const primaryOf = new Map<string, number>()
  keys.forEach((key, index) => {
    if (!primaryOf.has(key)) primaryOf.set(key, index)
  })

  // Concurrently: this pass sits in front of the response, and therefore in front of the first
  // clip a player is waiting on. Serially it cost a database round trip per chunk before the first
  // Fish call could even start.
  const claims = new Map(
    await Promise.all(
      [...primaryOf.values()].map(async (index) => [index, await claim(ctx, keys[index])] as const),
    ),
  )

  return texts.map((text, index) => {
    const cacheKey = keys[index]
    const primary = primaryOf.get(cacheKey)!
    const claimed = claims.get(primary)!
    const isPrimary = primary === index
    return {
      index,
      text,
      cacheKey,
      storagePath: `${ctx.scope}/${cacheKey}.mp3`,
      status: isPrimary || claimed.status !== 'claimed' ? claimed.status : 'mirror',
      url: claimed.url,
      mirrors: isPrimary
        ? keys.flatMap((key, other) => (key === cacheKey && other !== index ? [other] : []))
        : [],
    }
  })
}
