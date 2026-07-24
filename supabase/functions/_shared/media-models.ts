// F12 Assets Lab: the one place a client is allowed to influence which model runs.
//
// ai-proxy's rule is that models come from server-side state, never the request -- that's what
// stops a compromised client from pointing your credit at an arbitrary expensive model. The
// asset lab exists to compare models, so image/tts requests may carry a `model`, but only one
// that appears on this server-side allowlist. Text and embedding requests are unaffected.
//
// Extend without a code deploy:
//   supabase secrets set MEDIA_MODEL_ALLOWLIST="model-a,model-b,model-c"
// The defaults below are the same ids user_settings falls back to, so an empty env var still
// permits exactly what the app already uses.

const DEFAULT_ALLOWLIST = [
  'google/gemini-3.1-flash-lite-image',
  'mistralai/voxtral-mini-tts-2603',
  // Fish Audio TTS engines (default cloud TTS since 2026-07-24). ai-proxy routes these to Fish.
  's1',
  's2-pro',
  's2.1-pro',
  's2.1-pro-free',
]

function allowlist(): string[] {
  const raw = Deno.env.get('MEDIA_MODEL_ALLOWLIST')
  const fromEnv = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWLIST, ...fromEnv])]
}

export function isAllowedMediaModel(model: string): boolean {
  return allowlist().includes(model)
}

export function allowlistMessage(model: string): string {
  return (
    `Model '${model}' is not on the media allowlist. ` +
    `Allowed: ${allowlist().join(', ')}. ` +
    `Add it with: supabase secrets set MEDIA_MODEL_ALLOWLIST="...".`
  )
}
