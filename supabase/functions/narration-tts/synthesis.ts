// Making the audio: Fish call -> upload -> mark ready -> broadcast, in index order.

import { fishCostUsd, fishSpeak } from '../_shared/fish.ts'
import { BUCKET, signedUrl } from './cache.ts'
import type { ChunkPlan, SynthesisContext } from './cache.ts'

// Fish's Starter tier allows 5 concurrent requests ACCOUNT-WIDE. 3 leaves room for a voice
// preview, a second player's table, and the lab to be live at the same time.
export const DEFAULT_MAX_IN_FLIGHT = 3
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

async function broadcast(
  ctx: SynthesisContext,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { topic: `narration:${ctx.scope}`, event, payload: { line_id: ctx.lineId, ...payload }, private: true },
      ],
    }),
  })
  if (!res.ok) console.error(`narration broadcast failed: ${res.status} ${await res.text()}`)
}

/** One Fish call, retried on the statuses worth retrying (429 above all - see the concurrency cap). */
async function speak(ctx: SynthesisContext, text: string): Promise<Blob> {
  let lastDetail = ''
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fishSpeak({
      model: ctx.model,
      input: text,
      referenceId: ctx.referenceId,
      format: 'mp3',
      latency: 'balanced',
    })
    if (res.ok) return await res.blob()
    lastDetail = `${res.status} ${await res.text().catch(() => '')}`
    if (!RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS - 1) break
    // Jittered so two invocations that collided on the concurrency cap do not collide again.
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt + Math.random() * 400))
  }
  throw new Error(`Fish Audio error: ${lastDetail}`)
}

/**
 * Synthesizes one chunk and returns what the player needs, plus the bookkeeping to run afterwards.
 *
 * The two writes are deliberately NOT awaited before the caller broadcasts. Marking the row ready
 * and logging cost are two more round trips on the path between "audio exists" and "the player can
 * hear it", and neither is something the player waits for. They are collected and awaited at the
 * end of the run instead, so a dying isolate cannot drop them.
 */
async function synthesizeOne(
  ctx: SynthesisContext,
  plan: ChunkPlan,
): Promise<{ payload: Record<string, unknown>; bookkeeping: Promise<unknown> }> {
  const startedAt = Date.now()
  try {
    const audio = await speak(ctx, plan.text)
    const { error: uploadError } = await ctx.service.storage
      .from(BUCKET)
      .upload(plan.storagePath, audio, { contentType: 'audio/mpeg', upsert: true })
    if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

    const url = await signedUrl(ctx, plan.storagePath)
    const latencyMs = Date.now() - startedAt

    const bookkeeping = Promise.all([
      ctx.service
        .from('narration_clips')
        .update({ ready_at: new Date().toISOString(), byte_size: audio.size })
        .eq('scope', ctx.scope)
        .eq('cache_key', plan.cacheKey),
      // Logged per synthesized chunk only. A cache hit costs nothing and writes nothing, which is
      // what keeps the navbar's credit meter an honest picture of narration spend.
      ctx.service.from('usage_log').insert({
        user_id: ctx.ownerId,
        adventure_id: ctx.adventureId,
        agent_role: 'narrator',
        model: ctx.model,
        kind: 'tts',
        cost_usd: fishCostUsd(ctx.model, plan.text),
        latency_ms: latencyMs,
      }),
    ])

    return { payload: { url, ms: latencyMs }, bookkeeping }
  } catch (err) {
    // Releasing the reservation is what lets the next request retry, instead of inheriting a
    // tombstone that would keep this chunk silent until the 60s steal window elapsed.
    await ctx.service
      .from('narration_clips')
      .delete()
      .eq('scope', ctx.scope)
      .eq('cache_key', plan.cacheKey)
      .is('ready_at', null)
    throw err
  }
}

/**
 * Synthesizes every chunk this invocation claimed: the first alone, then the rest `maxInFlight` at
 * a time, publishing strictly in index order.
 *
 * Chunk 0 goes first and alone because it is what gates the text box appearing at all, so it gets
 * the concurrency budget to itself. The in-order release means a chunk that finishes early waits
 * for its predecessors - the client is told about chunk 4 only once chunk 3 is playable.
 */
export async function runSynthesis(
  ctx: SynthesisContext,
  plans: ChunkPlan[],
  maxInFlight: number,
): Promise<void> {
  const mine = plans.filter((plan) => plan.status === 'claimed')
  if (mine.length === 0) return

  const done = new Map<number, { event: string; payload: Record<string, unknown> }>()
  let cursor = 0
  const drain = async () => {
    while (cursor < plans.length) {
      const settled = done.get(cursor)
      // A chunk this invocation does not own is not ours to wait for - step over it, so one
      // awaiting chunk cannot hold back everything behind it. A mirror always sits after its
      // primary, so its entry is already present by the time the cursor reaches it.
      if (!settled) {
        if (plans[cursor].status === 'claimed' || plans[cursor].status === 'mirror') return
        cursor++
        continue
      }
      done.delete(cursor)
      cursor++
      await broadcast(ctx, settled.event, settled.payload)
    }
  }
  // Serialized: `drain` awaits inside its loop, so two workers finishing at once would otherwise
  // both read the same cursor and broadcast the same chunk twice.
  let chain: Promise<void> = Promise.resolve()
  const release = () => {
    chain = chain.then(drain)
    return chain
  }

  // Bookkeeping deferred off the broadcast path (see synthesizeOne), awaited before the run ends.
  const bookkeeping: Promise<unknown>[] = []

  const record = async (plan: ChunkPlan) => {
    // The same outcome is recorded for every box that plays this clip, under each box's own index,
    // so a repeated line reads aloud both times off a single synthesis.
    const indices = [plan.index, ...plan.mirrors]
    try {
      const result = await synthesizeOne(ctx, plan)
      bookkeeping.push(result.bookkeeping)
      for (const index of indices) {
        done.set(index, { event: 'chunk_ready', payload: { ...result.payload, index } })
      }
    } catch (err) {
      console.error(`narration chunk ${plan.index} failed`, err)
      const error = err instanceof Error ? err.message : 'synthesis failed'
      for (const index of indices) done.set(index, { event: 'chunk_failed', payload: { index, error } })
    }
    await release()
  }

  const [first, ...rest] = mine
  await record(first)

  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, maxInFlight), rest.length) }, async () => {
      while (next < rest.length) await record(rest[next++])
    }),
  )

  // Settled, not all: a failed ready_at write costs a future cache miss, never this line's audio.
  await Promise.allSettled(bookkeeping)
}
