// Narrator flows (F07 SS5.1 + SS6): outcome narration for adjudicated actions and the
// "Narrate the next story" options flow. Full-AI auto-picks option 1 - the same two proposal
// rows a human DM will click through when the console lands in Phase 10. Every draft passes
// the Consistency Manager: one constrained regeneration on violation, then the minimal
// mechanical fallback + an incident event (F15).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { dialogueGateActive, dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json, PendingReviewState } from '../_shared/state/index.ts'
import { runClaimCheck, runConsistency, runNarrator, runNarratorOptions } from './agents.ts'
import type { AgentEnv, NarrationStyle } from './agents.ts'
import { buildCanon } from './canon.ts'
import { retrieveMemories } from './memory.ts'
import {
  agentContextLines, appendLinesDiff, loadPartyCharacters, newLine, partyProfileLines, typingDiff,
} from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { assertOk, commitDiffs, loadContext, loadState, logEvent } from './util.ts'

/**
 * Rollout switch for the rebuilt prose check (2026-07-23).
 *   'off'    - skip entirely.
 *   'shadow' - run it, log `claim_check_shadow`, publish the draft untouched. No player impact,
 *              and it is the only way to learn the true-catch rate: the old checker's rate was
 *              unmeasurable because it blocked, so a false positive and a true one looked alike.
 *   'enforce'- one constrained regeneration when a dead mouth speaks; keep the better draft.
 *
 * Starts at 'shadow'. The class it targets - the speaking corpse - is real and recurring, but
 * the last thing to block prose was wrong 14 times out of 14, so this one earns its authority
 * with data before it gets any.
 */
export const PROSE_CLAIM_CHECK: 'off' | 'shadow' | 'enforce' = 'shadow'

/**
 * The rebuilt check: model perceives (who does this passage SHOW speaking or acting?), code
 * judges (are any of them dead or absent?). In 'shadow' the draft comes back untouched.
 */
async function claimGuard(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  draft: string,
  canon: { npcs: { id: string; name: string }[]; npcStates: Record<string, string> },
  regenerate: (constraint: string) => Promise<string>,
): Promise<string> {
  if (PROSE_CLAIM_CHECK === 'off') return draft
  const roster = canon.npcs.map((n) => ({ ...n, state: canon.npcStates[n.id] ?? 'alive' }))
  const { violations, checked } = await runClaimCheck(env, draft, roster)
  // Log the CLEAN checks too. Shadow mode exists to measure a true-catch rate, and a log that
  // only records catches cannot distinguish "ran and found nothing" from "never ran" - which is
  // exactly the blind spot that let the old checker's 0-for-14 record go unnoticed for so long.
  // `checked.length`, NOT `checked` - an empty array is truthy, so the original form logged a
  // clean check on every narration including the ones where the gate never fired and no model
  // ran. Run 02c5f711 read as 29 checks when it made 7 (22 events carried `suspects: []`),
  // inflating the evidence base 4x - the precise blindness this log was added to remove.
  if (checked.length > 0 && violations.length === 0) {
    await logEvent(service, env.adventureId, sessionId, 'claim_check_clean', {
      suspects: checked, source: 'narration',
    }).catch(() => {})
    return draft
  }
  if (violations.length === 0) return draft

  await logEvent(service, env.adventureId, sessionId, 'claim_check_shadow', {
    enforced: PROSE_CLAIM_CHECK === 'enforce',
    violations: violations.map((v) => ({ name: v.name, role: v.role, state: v.state })) as unknown as Json,
    draft: draft.slice(0, 400),
  }).catch(() => {})
  if (PROSE_CLAIM_CHECK !== 'enforce') return draft

  const constraint = violations.map((v) => v.constraint).join(' ')
  const second = await regenerate(`NEVER: ${constraint}`).catch(() => draft)
  // Keep whichever draft is clean; a second failure keeps the prose, never a mechanical line.
  const retry = await runClaimCheck(env, second, roster)
  return retry.violations.length === 0 ? second : draft
}

function factSheet(state: GameState): string {
  const recent = agentContextLines(state, 6)
  return [
    `Location: ${state.scene.locationName || 'unknown'}; mode: ${state.scene.mode}; day ${state.scene.day}`,
    `Party: ${state.players.list.map((p) => p.name).join(', ')}`,
    `Recent lines: ${recent.join(' | ')}`,
  ].join('\n')
}

/** "Dead before the story began" is scene-setting, not a contradiction - spell that out. */
async function deadRosterLine(
  service: SupabaseClient,
  adventureId: string,
  npcStates: Record<string, string>,
): Promise<string> {
  const { data } = await service
    .from('npcs')
    .select('id, name, initial_state')
    .eq('adventure_id', adventureId)
  // Both sources: authored start state AND anyone who has died or left during play. The narrator
  // must be able to NAME them - a mystery discusses its victim constantly - but never have them
  // speak or walk. Stating that as a fact beats blocking every mention, which silenced the
  // narrator six times in one session (live 2026-07-21).
  const rows = ((data ?? []) as { id: string; name: string; initial_state: string }[])
    .map((n) => ({ name: n.name, state: npcStates[n.id] ?? n.initial_state ?? 'alive' }))
    .filter((n) => n.state !== 'alive')
  if (rows.length === 0) return ''
  const dead = rows.filter((n) => n.state === 'dead').map((n) => n.name)
  const absent = rows.filter((n) => n.state === 'absent').map((n) => n.name)
  return (
    (dead.length > 0
      ? `
DEAD: ${dead.join(', ')}. Name them, describe their body, discuss them and investigate ` +
        'them freely - but they CANNOT speak, act, or appear alive.'
      : '') +
    (absent.length > 0
      ? `
Not present in the story yet: ${absent.join(', ')} - may be spoken about, but cannot appear.`
      : '')
  )
}

export const MECHANICAL_FALLBACK = 'The attempt is resolved; the outcome stands.'

/**
 * Draft -> consistency -> (regen once) -> commit as a narrator line. Returns the published
 * text. A second violation logs an incident but KEEPS the prose; `fallback` is now only the
 * demo path's stand-in for a model that isn't there.
 */
export async function publishNarration(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  prompt: string,
  fallback: string = MECHANICAL_FALLBACK,
  style: NarrationStyle = 'beat',
): Promise<string> {
  const state = (await loadState(service, env.adventureId)).state
  const npcStates = state.dm?.facts.npcStates ?? {}
  // Anyone the guide authored as already dead/absent (a murder victim) may be NAMED, examined
  // and discussed - that is the whole subject of a mystery. Only speaking or appearing alive is
  // off limits, which is a judgement, so it goes to the checker as a fact rather than a
  // deterministic name-match block (which fell back to mechanical text, live 2026-07-21).
  const preexisting = await deadRosterLine(service, env.adventureId, npcStates)
  const facts = `${factSheet(state)}${preexisting}`
  // Retrieval memory (Slice 7): long-form cutscenes ground on what past sessions established.
  const memories = style === 'exposition' ? await retrieveMemories(service, env, prompt) : []
  const memoryLines = memories.length > 0
    ? `\n\nEstablished earlier (carry these forward, never contradict them):\n${memories.map((m) => `- ${m}`).join('\n')}`
    : ''
  // Personalization (2026-07-20): the narrator sees who the party members ARE, not just names.
  const profiles = await partyProfileLines(service, await loadPartyCharacters(service, env.adventureId))
  const partyLines = profiles.length > 0
    ? `\n\nThe party (weave their traits and quirks in when relevant):\n${profiles.map((p) => `- ${p}`).join('\n')}`
    : ''
  // The narrator must see the same facts the checker holds it to, or it invents scenes
  // the checker then rightly blocks (seen live: every idle nudge fell back to mechanical).
  const grounded = `${prompt}\n\nEstablished scene facts - stay consistent with these:\n${facts}${partyLines}${memoryLines}`
  // CANON ONLY for the checker (Phase 6). It used to receive `facts` (which carries the live
  // transcript under "Recent lines") plus the generating prompt verbatim - so a draft that
  // correctly followed its instruction was flagged as contradicting it, blocked, regenerated
  // under a NEVER: constraint quoting the very thing it was asked to write, and on the second
  // failure published the mechanical fallback. See canon.ts for the full account.
  const canon = await buildCanon(service, env.adventureId, state)

  let text: string
  try {
    text = await runNarrator(env, grounded, undefined, style)
    text = await claimGuard(service, env, sessionId, text, canon, (constraint) =>
      runNarrator(env, grounded, constraint, style))
    let verdict = await runConsistency(env, text, canon.npcs, canon.npcStates, canon.text, { restrictions: canon.restrictions })
    if (!verdict.ok) {
      const constraint = verdict.violations.map((v) => `${v.claim} (${v.conflictsWith})`).join('; ')
      await logEvent(service, env.adventureId, sessionId, 'consistency_blocked', {
        draft: text, violations: constraint, stage: 'first',
      })
      text = env.demo ? fallback : await runNarrator(env, grounded, `NEVER: ${constraint}`, style)
      verdict = await runConsistency(env, text, canon.npcs, canon.npcStates, canon.text, { restrictions: canon.restrictions })
      if (!verdict.ok) {
        // Keep the REGENERATED PROSE, not the canned line. Every narration violation inspected
        // across three paid escort runs (2026-07-23) was a false positive - aftermath of a
        // survived ambush "contradicting" ambush_survived, corpse description "contradicting"
        // the corpse - while the fallback is guaranteed-terrible writing the player actually
        // reads. A mildly-nitpicked sentence beats "The attempt is resolved; the outcome
        // stands." in every case, and the incident still logs so the checker's true-catch rate
        // stays measurable. The genuinely dangerous case (a dead NPC SPEAKING) is caught
        // deterministically upstream via draftIsNpcSpeech and never relied on this path.
        await logEvent(service, env.adventureId, sessionId, 'incident', {
          kind: 'consistency_double_failure',
          violations: verdict.violations as unknown as Json,
          resolution: 'kept_prose',
        })
      }
    }
  } catch (err) {
    // A narrator outage must not leave typing:true locking every future intent.
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    throw err
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
  style: NarrationStyle = 'beat',
): Promise<'published' | 'review_staged'> {
  const state = (await loadState(service, env.adventureId)).state
  if (!dialogueGateActive({ mode: env.mode, autoDialogue: dmSettings(state).autoDialogue })) {
    await publishNarration(service, env, sessionId, prompt, MECHANICAL_FALLBACK, style)
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
  let options: string[]
  try {
    options = opts?.options ?? (await runNarratorOptions(env, optionsPrompt))
    if (options.length === 0) throw new Error('Narrator produced no options')
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    throw err
  }
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
