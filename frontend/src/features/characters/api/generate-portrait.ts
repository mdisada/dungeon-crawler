import { env } from '@/config/env'
import { callEdgeFunction } from '@/lib/edge-function'

interface OpenRouterImageResponse {
  data?: { url?: string; b64_json?: string }[]
}

async function requestImage(payload: Record<string, unknown>): Promise<string> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'image', agent_role: 'user_direct', payload }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ai-proxy image request failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as OpenRouterImageResponse
  const first = json.data?.[0]
  const imageUrl = first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined)
  if (!imageUrl) throw new Error('ai-proxy image response had no image data')
  return imageUrl
}

// F02 SS4: full-body source image, 9:16. Behind VITE_PLACEHOLDER_MEDIA so the wizard is fully
// testable without spending OpenRouter credit (DEVELOPMENT-PLAN.md SS1.3).
export async function generatePortrait(prompt: string): Promise<string> {
  if (env.placeholderMedia) return '/placeholders/fullbody.png'
  return requestImage({ prompt, aspect_ratio: '9:16', output_format: 'png' })
}

// Image-to-image edit: the current portrait plus the user's change request go back through the
// same OpenRouter images endpoint (`input_references`, data URLs accepted).
export async function editPortrait(currentImageDataUrl: string, editPrompt: string): Promise<string> {
  if (env.placeholderMedia) return '/placeholders/fullbody.png'
  return requestImage({
    prompt: editPrompt,
    aspect_ratio: '9:16',
    output_format: 'png',
    input_references: [{ type: 'image_url', image_url: { url: currentImageDataUrl } }],
  })
}
