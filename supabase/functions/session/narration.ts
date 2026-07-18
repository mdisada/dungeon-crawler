// Narrator flows (F07 SS5.1 + SS6): outcome narration for adjudicated actions and the
// "Narrate the next story" options flow. Full-AI auto-picks option 1 - the same two proposal
// rows a human DM will click through when the console lands in Phase 10. Every draft passes
// the Consistency Manager: one constrained regeneration on violation, then the minimal
// mechanical fallback + an incident event (F15).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { dialogueGateActive, dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json, PendingReviewState } from '../_shared/state/index.ts'
import { runConsistency, runNarrator, runNarratorOptions } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { appendLinesDiff, newLine, typingDiff } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { assertOk, commitDiffs, loadContext, loadState, logEvent } from './util.ts'

async function adventureNpcs(service: SupabaseClient, adventureId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await service.from('npcs').select('id, name').eq('adventure_id', adventureId)
  assertOk(error, 'npcs load failed')
  return (data ?? []) as { id: string; name: string }[]
}

function factSheet(state: GameState): string {
  const recent = state.dialogue.lines.slice(-6).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`)
  return [
    `Location: ${state.scene.locationName || 'unknown'}; mode: ${state.scene.mode}; day ${state.scene.day}`,
    `Party: ${state.players.list.map((p) => p.name).join(', ')}`,
    `Recent lines: ${recent.join(' | ')}`,
  ].join('\n')
}

export const MECHANICAL_FALLBACK = 'The attempt is resolved; the outcome stands.'

/**
 * Draft -> consistency -> (regen once) -> commit as a narrator line. Returns the published
 * text. `fallback` is the minimal mechanical description used when regeneration also fails.
 */
export async function publishNarration(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  prompt: string,
  fallback: string = MECHANICAL_FALLBACK,
): Promise<string> {
  const state = (await loadState(service, env.adventureId)).state
  const npcs = await adventureNpcs(service, env.adventureId)
  const npcStates = state.dm?.facts.npcStates ?? {}
  const facts = factSheet(state)

  let text = await runNarrator(env, prompt)
  let verdict = await runConsistency(env, text, npcs, npcStates, facts)
  if (!verdict.ok) {
    const constraint = verdict.violations.map((v) => `${v.claim} (${v.conflictsWith})`).join('; ')
    await logEvent(service, env.adventureId, sessionId, 'consistency_blocked', {
      draft: text, violations: constraint, stage: 'first',
    })
    text = env.demo ? fallback : await runNarrator(env, prompt, `NEVER: ${constraint}`)
    verdict = await runConsistency(env, text, npcs, npcStates, facts)
    if (!verdict.ok) {
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'consistency_double_failure',
        violations: verdict.violations as unknown as Json,
      })
      text = fallback
    }
  }

  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'narration',
    payload: { text },
    mode: 'auto',
    blocking: true,
    summary: text.slice(0, 80),
  })
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(null, null, text)]),
    typingDiff(false),
  ])
  await logEvent(service, env.adventureId, sessionId, 'narration_published', { text })
  return text
}

/**
 * Slice 3 gate for every narration beat: publish directly (full-AI / auto-dialogue on) or
 * stage a gist review of candidate directions for the DM console.
 */
export async function narrationBeat(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  prompt: string,
  label: string,
): Promise<'published' | 'review_staged'> {
  const state = (await loadState(service, env.adventureId)).state
  if (!dialogueGateActive({ mode: env.mode, autoDialogue: dmSettings(state).autoDialogue })) {
    await publishNarration(service, env, sessionId, prompt)
    return 'published'
  }
  await stageNarrationReview(service, env, sessionId, prompt, label)
  return 'review_staged'
}

/** Stages a narration review: candidate directions in dm.pendingReview, typing cleared. */
export async function stageNarrationReview(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  prompt: string,
  label: string,
  opts?: { options?: string[]; rejected?: string[] },
): Promise<void> {
  const optionsPrompt = opts?.rejected?.length
    ? `${prompt}\nThe DM rejected these directions - offer genuinely different ones: ${opts.rejected.join(' | ')}`
    : prompt
  const options = opts?.options ?? (await runNarratorOptions(env, optionsPrompt))
  if (options.length === 0) throw new Error('Narrator produced no options')
  const review: PendingReviewState = {
    id: crypto.randomUUID(),
    kind: 'narration',
    label,
    prompt,
    candidates: options.slice(0, 3).map((gist) => ({ id: crypto.randomUUID(), gist })),
    createdAt: new Date().toISOString(),
  }
  await commitDiffs(service, env.adventureId, () => [
    { domain: 'dm', patch: { pendingReview: review as unknown as Json } },
    typingDiff(false),
  ])
  await logEvent(service, env.adventureId, sessionId, 'review_staged', {
    review_id: review.id, kind: 'narration', label, gists: review.candidates.map((c) => c.gist) as unknown as Json,
    regenerated: Boolean(opts?.rejected),
  })
}

/** Expansion prompt: direction first so even truncating narrators (demo) keep the DM's pick. */
export function directedNarrationPrompt(basePrompt: string, direction: string): string {
  return `The DM chose this direction - follow it closely: "${direction}"\n${basePrompt}`
}

/**
 * "Narrate the next story" (F07 SS5.1). Options are generated and logged as a proposal; in
 * auto mode option 1 is picked and published immediately. The response carries all options so
 * the Phase 10 console can render chips on this exact contract.
 */
export async function narrateNext(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  freePrompt: string | undefined,
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can drive narration' } }
  const row = await loadState(service, adventureId)
  if (!row.state.session.id || row.state.session.status !== 'active') {
    return { status: 409, body: { error: 'No active session' } }
  }
  if (row.state.dm?.pendingReview) {
    return { status: 409, body: { error: 'Decide the pending review first' } }
  }
  const sessionId = row.state.session.id
  const env: AgentEnv = { service, adventureId, creatorId: ctx.adventure.creator_id, demo: ctx.adventure.demo, mode: ctx.adventure.mode }

  await commitDiffs(service, adventureId, () => [typingDiff(true)])
  try {
    const contextPrompt = [
      freePrompt || 'Narrate the next story beat.',
      factSheet(row.state),
      `Current objective: ${row.state.objectives.list.find((o) => o.id === row.state.objectives.currentId)?.title ?? 'none'}`,
    ].join('\n')

    const options = await runNarratorOptions(env, contextPrompt)
    if (options.length === 0) {
      await commitDiffs(service, adventureId, () => [typingDiff(false)])
      return { status: 502, body: { error: 'Narrator produced no options' } }
    }
    const gated = dialogueGateActive({ mode: env.mode, autoDialogue: dmSettings(row.state).autoDialogue })
    await recordProposal(service, {
      adventureId,
      sessionId,
      type: 'narration_options',
      payload: { prompt: freePrompt ?? null, chosen: gated ? null : 0 },
      options: options as unknown as Json,
      mode: gated ? 'human' : 'auto',
      blocking: true,
      summary: `options: ${options[0].slice(0, 60)}...`,
    })

    if (gated) {
      // Reuse the options just generated as the review candidates - no second agent call.
      await stageNarrationReview(service, env, sessionId, `Continue the story.\nContext:\n${contextPrompt}`, 'Story narration', { options })
      return { status: 200, body: { ok: true, resolved: 'review_staged', options } }
    }

    const text = await publishNarration(
      service, env, sessionId,
      `Continue the story along this direction: ${options[0]}\nContext:\n${contextPrompt}`,
    )
    return { status: 200, body: { ok: true, options, chosen: 0, text } }
  } catch (err) {
    await commitDiffs(service, adventureId, () => [typingDiff(false)])
    throw err
  }
}
