import { callEdgeFunction } from '@/lib/edge-function'
import type { NarrateArgs, NarrationPlan } from '../types'

/**
 * Asks `narration-tts` for one line's reveal chunks.
 *
 * Fire-and-forget by design: the response comes back as soon as the cache has been consulted, so
 * chunks that already exist arrive here with a URL and are playable immediately. Everything else
 * arrives later on the `narration:{scope}` broadcast channel - subscribe BEFORE calling this, or a
 * fast chunk can land before the listener is attached.
 *
 * `silent: true` is a normal outcome, not a failure: it means no voice is assigned anywhere in the
 * chain (NPC -> adventure narrator -> nothing), so this line is not spoken and the caller should
 * ungate immediately.
 */
/**
 * Registers the adventure's narrator voice with Fish without synthesizing anything.
 *
 * A built-in voice ships with no `fish_reference_id`, so the first line to use one pays ~9s in
 * Fish's POST /model before a word is spoken. Sent when the play screen mounts, that cost lands
 * while the table is still in the lobby. Idempotent and free once the id is cached; best-effort,
 * because the real request re-does the same resolution anyway.
 */
export async function warmNarrationVoice(adventureId: string): Promise<void> {
  await callEdgeFunction('narration-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adventure_id: adventureId, warm: true }),
  })
}

export async function requestNarration({
  adventureId,
  lineId,
  npcId = null,
  chunks,
  model,
  voiceProfileId = null,
  maxInFlight,
  force = false,
}: NarrateArgs): Promise<NarrationPlan> {
  const res = await callEdgeFunction('narration-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adventure_id: adventureId,
      line_id: lineId,
      npc_id: npcId,
      chunks,
      ...(model ? { model } : {}),
      ...(voiceProfileId ? { voice_profile_id: voiceProfileId } : {}),
      ...(maxInFlight ? { max_in_flight: maxInFlight } : {}),
      ...(force ? { force: true } : {}),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`narration-tts failed: ${res.status} ${detail}`)
  }

  const body = (await res.json()) as {
    line_id: string
    silent: boolean
    model: string
    voice_profile_id?: string | null
    chunks: { index: number; status: 'cached' | 'claimed' | 'awaiting' | 'mirror'; url: string | null }[]
    timings?: Record<string, number>
  }
  return {
    lineId: body.line_id,
    silent: body.silent,
    model: body.model,
    voiceProfileId: body.voice_profile_id ?? null,
    chunks: body.chunks,
    timings: body.timings ?? {},
  }
}
