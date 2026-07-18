import { env } from '@/config/env'
import { callEdgeFunction } from '@/lib/edge-function'
import { supabase } from '@/lib/supabase'

const SIGNED_URL_TTL_SECONDS = 3600

async function requestImage(adventureId: string, payload: Record<string, unknown>): Promise<string> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'image', agent_role: 'user_direct', adventure_id: adventureId, payload }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ai-proxy image request failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] }
  const first = json.data?.[0]
  const imageUrl = first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined)
  if (!imageUrl) throw new Error('ai-proxy image response had no image data')
  return imageUrl
}

async function toBlob(imageUrl: string): Promise<Blob> {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error('Could not download the generated image')
  return res.blob()
}

/** Stores media under adventure-media/{adventureId}/... and returns the storage path. */
export async function uploadAdventureMedia(adventureId: string, relativePath: string, blob: Blob): Promise<string> {
  const path = `${adventureId}/${relativePath}`
  const { error } = await supabase.storage
    .from('adventure-media')
    .upload(path, blob, { contentType: blob.type || 'image/png', upsert: true })
  if (error) throw error
  return path
}

export async function getAdventureMediaUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('adventure-media').createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/** Manual-trigger only per F04 SS5.2/SS5.3 - callers wire this to an explicit Generate click. */
export async function generateGuideImage(
  adventureId: string,
  prompt: string,
  kind: 'background' | 'npc' | 'map',
): Promise<Blob> {
  if (env.placeholderMedia) {
    const placeholder = kind === 'npc' ? '/placeholders/fullbody.png' : `/placeholders/${kind}.png`
    return toBlob(placeholder)
  }
  const aspectRatio = kind === 'npc' ? '9:16' : kind === 'map' ? '1:1' : '16:9'
  const fullPrompt =
    kind === 'map'
      ? `Top-down tactical battle map, orthographic view, 1024x1024, painted fantasy style, clear open floor areas and obstacles, no grid lines, no text or labels. ${prompt}`
      : prompt
  const imageUrl = await requestImage(adventureId, { prompt: fullPrompt, aspect_ratio: aspectRatio, output_format: 'png' })
  return toBlob(imageUrl)
}
