// Fish Audio TTS provider (default cloud TTS since 2026-07-24). The key is a server-side edge
// secret (FISH_AUDIO_API_KEY) -- never sent by or exposed to the client, same rule as OpenRouter.
//
// Voice selection:
//   - reference_id: a Fish voice model id (their community library, or one we created).
//   - cloning: register an uploaded clip as a Fish model once (POST /model, multipart, NO
//     transcript required -- Fish auto-transcribes), which returns a reference_id we then cache
//     on the voice_profiles row and reuse. Per-request `references` cloning is avoided: it needs
//     a transcript we don't have and msgpack encoding.

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts'
const FISH_MODEL_URL = 'https://api.fish.audio/model'

// Engine ids that mean "route to Fish". Distinct from OpenRouter's `mistralai/...` ids, so the
// model string alone tells ai-proxy which provider to use.
const FISH_MODELS = new Set(['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free'])

export function isFishModel(model: string): boolean {
  return FISH_MODELS.has(model)
}

// Fish bills by the UTF-8 byte size of the input text (docs: pricing-and-rate-limits). All paid
// engines are $15 / 1M bytes; s2.1-pro-free is $0. No cost is returned per request, so it's
// computed deterministically from the input rather than read back.
const FISH_USD_PER_BYTE: Record<string, number> = {
  s1: 0.000015,
  's2-pro': 0.000015,
  's2.1-pro': 0.000015,
  's2.1-pro-free': 0,
}

export function fishCostUsd(model: string, input: string): number {
  const rate = FISH_USD_PER_BYTE[model] ?? 0
  return new TextEncoder().encode(input).length * rate
}

function fishKey(): string {
  const key = Deno.env.get('FISH_AUDIO_API_KEY')
  if (!key) throw new Error('FISH_AUDIO_API_KEY secret is not set')
  return key
}

/**
 * Registers clip bytes as a Fish voice model and returns its reference_id. `train_mode: fast`
 * trains synchronously (the row comes back state:"trained"), so the id is usable immediately.
 */
export async function createFishVoice(name: string, clip: Blob): Promise<string> {
  const form = new FormData()
  form.append('title', name.slice(0, 100) || 'voice')
  form.append('type', 'tts')
  form.append('train_mode', 'fast')
  form.append('visibility', 'private')
  form.append('voices', clip, 'reference.wav')

  const res = await fetch(FISH_MODEL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fishKey()}` },
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Fish model create failed: ${res.status} ${detail}`)
  }
  const json = await res.json()
  const id = json._id ?? json.id
  if (!id) throw new Error('Fish model create returned no id')
  return id as string
}

/**
 * Synthesizes speech. `referenceId` picks the voice; omitted uses Fish's built-in default voice.
 * Returns the upstream Response so the caller can stream raw audio bytes straight to the client.
 */
export function fishSpeak(opts: {
  model: string
  input: string
  referenceId?: string | null
  format?: string
}): Promise<Response> {
  const { model, input, referenceId, format = 'mp3' } = opts
  return fetch(FISH_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fishKey()}`,
      'Content-Type': 'application/json',
      model, // Fish selects the engine via a header, not the body
    },
    body: JSON.stringify({
      text: input,
      ...(referenceId ? { reference_id: referenceId } : {}),
      format,
    }),
  })
}
