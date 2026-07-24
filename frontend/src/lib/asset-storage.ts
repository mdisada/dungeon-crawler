import { supabase } from '@/lib/supabase'

/**
 * The `assets` bucket is private and owner-scoped (see the 20260724 migration), and both
 * generation routes write into it: for OpenRouter the browser uploads the bytes it got back,
 * for the local worker the worker uploads with the service key and broadcasts the path. Every
 * consumer therefore holds a *path* and signs it at render time -- same pattern as the
 * characters and voices buckets.
 */

export const ASSETS_BUCKET = 'assets'

const SIGNED_URL_TTL_SECONDS = 3600

export type AssetKind = 'image' | 'audio' | 'refs'

const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
}

export function assetPath(userId: string, kind: AssetKind, name: string, extension: string): string {
  return `${userId}/${kind}/${name}.${extension}`
}

export async function uploadAsset(path: string, blob: Blob): Promise<string> {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, blob, {
    contentType: blob.type || EXTENSION_CONTENT_TYPE[extension] || 'application/octet-stream',
    upsert: true,
  })
  if (error) throw error
  return path
}

export async function getAssetUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(ASSETS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/** Content-addressed so re-picking the same reference file doesn't re-upload it. */
export async function uploadReference(userId: string, file: Blob, extension: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return uploadAsset(assetPath(userId, 'refs', hash, extension), file)
}
