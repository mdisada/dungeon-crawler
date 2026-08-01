// Signing the media GameState points at (2026-08-01).
//
// State carries MediaRefs - bucket + path - and never URLs, because a URL expires and GameState is
// durable. Signing happens here, in the browser, against the player's own authenticated session,
// so every render starts from a fresh link and nothing can go stale between two of them.
//
// Batched per bucket rather than per image: a roleplay scene is a background plus two or three
// portraits, and a battle is that plus a map and every token. `createSignedUrls` signs a whole
// bucket's worth in one round trip.

import { supabase } from '@/lib/supabase'
import type { MediaBucket, MediaRef } from '@rules/state'

/** An hour is plenty - the resolver re-signs long before this, and the refs never expire. */
const SIGNED_URL_TTL_SECONDS = 3600

export type SignedMedia = Record<string, string>

/**
 * Placeholder art is configured as an absolute or root-relative URL rather than a storage object.
 * Those are already renderable and signing them would fail, so they pass straight through.
 */
export function isDirectUrl(path: string): boolean {
  return path.startsWith('http') || path.startsWith('/')
}

/** Stable key for a ref - two buckets may legitimately hold the same path. */
export function mediaKey(ref: MediaRef): string {
  return `${ref.bucket}\n${ref.path}`
}

/**
 * Sign every ref given, keyed by mediaKey. A path that fails to sign is simply absent from the
 * result, which the resolver renders as "no art" - the same fallback an NPC without a portrait
 * already gets, rather than a broken image.
 */
export async function signMediaRefs(refs: MediaRef[]): Promise<SignedMedia> {
  const byBucket = new Map<MediaBucket, Set<string>>()
  const signed: SignedMedia = {}

  for (const ref of refs) {
    if (isDirectUrl(ref.path)) {
      signed[mediaKey(ref)] = ref.path
      continue
    }
    const paths = byBucket.get(ref.bucket) ?? new Set<string>()
    paths.add(ref.path)
    byBucket.set(ref.bucket, paths)
  }

  await Promise.all(
    [...byBucket].map(async ([bucket, paths]) => {
      const { data } = await supabase.storage.from(bucket).createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS)
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) signed[mediaKey({ bucket, path: entry.path })] = entry.signedUrl
      }
    }),
  )

  return signed
}
