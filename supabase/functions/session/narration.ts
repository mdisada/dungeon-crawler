// Narrator flows (F07 SS5.1 + SS6): outcome narration for adjudicated actions and the
// "Narrate the next story" options flow. Full-AI auto-picks option 1 - the same two proposal
// rows a human DM will click through when the console lands in Phase 10. Every draft passes
// the Consistency Manager: one constrained regeneration on violation, then the minimal
// mechanical fallback + an incident event (F15).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { foreignCharacters, stripForeign } from '../_shared/guide/charset.ts'
import { dialogueGateActive, dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json, PendingReviewState } from '../_shared/state/index.ts'
import { runClaimCheck, runConsistency, runNarrator, runNarratorOptions, runOutcomeClaimCheck } from './agents.ts'
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
 * Started at 'shadow'. The class it targets - the speaking corpse - is real and recurring, but
 * the last thing to block prose was wrong 14 times out of 14, so this one earned its authority
 * with data first. Flipped to 'enforce' 2026-07-25 on that data: the shadow log caught the
 * departed Elara Meadowlight speaking a full scene after she vanished ("state: absent, role:
 * speaks") and published it anyway, which then fed the ledger a live sighting and thrashed her
 * state absent->alive. Unlike the flags checker, this is a perceive-then-deterministically-judge
 * pass (who does the passage SHOW acting; are they dead/absent), not a fragment-vs-proposition
 * guess - the exact shape that can be enforced without the false-positive tax.
 */
export const PROSE_CLAIM_CHECK: 'off' | 'shadow' | 'enforce' = 'enforce'

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

/**
 * Premature-resolution guard (2026-07-26). While an encounter is OPEN its outcome belongs to the
 * engine - the tier the party plays to, and the outcome map that tier selects. Prose that
 * declares the goal already won or lost puts the transcript ahead of the state, and every line
 * after it inherits the contradiction.
 *
 * Only runs while something is actually open, so a cutscene (where narration SHOULD move things
 * along) is untouched. One constrained regeneration; a second claim keeps the prose and logs -
 * same trade the consistency pass settled on, for the same reason (guaranteed-bad canned text is
 * worse than a slightly over-eager sentence).
 */
async function outcomeGuard(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  draft: string,
  state: GameState,
  regenerate: (constraint: string) => Promise<string>,
): Promise<string> {
  const encounter = state.encounter
  if (OUTCOME_CLAIM_CHECK === 'off' || !encounter) return draft
  const goal = `${encounter.label}${encounter.stakes ? ` (at stake: ${encounter.stakes})` : ''}`
  if (!(await runOutcomeClaimCheck(env, draft, goal))) return draft

  await logEvent(service, env.adventureId, sessionId, 'outcome_claim_blocked', {
    enforced: OUTCOME_CLAIM_CHECK === 'enforce', label: encounter.label, draft: draft.slice(0, 400),
  }).catch(() => {})
  if (OUTCOME_CLAIM_CHECK !== 'enforce') return draft

  const second = await regenerate(
    `NEVER state or imply that "${encounter.label}" has already been achieved, won, failed or ` +
    'otherwise settled - it is still being played and only the engine decides how it ends. ' +
    'Write the tension and the attempt, and stop short of the outcome.',
  ).catch(() => draft)
  return (await runOutcomeClaimCheck(env, second, goal)) ? draft : second
}

/**
 * Rollout switch for the premature-resolution guard. Starts at 'enforce': unlike the flags
 * checker this is a closed question against a stated goal with a safe default (false on doubt or
 * outage), and the failure it prevents - the transcript declaring a win the state never recorded
 * - poisons every subsequent line rather than merely reading oddly.
 */
export const OUTCOME_CLAIM_CHECK: 'off' | 'shadow' | 'enforce' = 'enforce'

/**
 * Characters from outside the adventure's language, published to the player (2026-07-28).
 *
 * The guide pipeline gained a charset gate when an ending summary shipped reading "not the官方
 * story". The LIVE NARRATOR never had one - and it reaches the player far more often than the
 * guide does. Across twelve recorded runs, 3 of 337 published lines carried spliced CJK:
 * "*Drift彤* glide past the harbor stones", "The堵塞 channels can't be cleared with knives".
 *
 * Enforced harder than the prose checks above, because it is not a judgement call. A dead NPC
 * "speaking" is a model's reading of ambiguous prose - wrong 14 times out of 14 when it last had
 * authority. A Han character in an English sentence is a fact with no false positive available,
 * so a second failure does NOT keep the prose: the offending characters are removed. Deleting
 * them is always readable ("*Drift*", "The channels") and never worse than what it replaces,
 * which is not true of the mechanical fallback.
 */
async function charsetGuard(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  draft: string,
  regenerate: (constraint: string) => Promise<string>,
): Promise<string> {
  const bad = foreignCharacters(draft)
  if (bad.length === 0) return draft
  const shown = bad.slice(0, 8).join(' ')
  await logEvent(service, env.adventureId, sessionId, 'charset_blocked', {
    characters: shown, draft: draft.slice(0, 400),
  }).catch(() => {})
  const second = await regenerate(
    `NEVER use characters outside English - your previous draft contained ${shown}. ` +
    'Write every word in English; do not transliterate and do not leave placeholders.',
  ).catch(() => draft)
  const stillBad = foreignCharacters(second)
  if (stillBad.length === 0) return second
  await logEvent(service, env.adventureId, sessionId, 'incident', {
    kind: 'charset_stripped', characters: stillBad.slice(0, 8).join(' '),
  }).catch(() => {})
  return stripForeign(second)
}

function factSheet(state: GameState): string {
  const recent = agentContextLines(state, 6)
  return [
    `Location: ${state.scene.locationName || 'unknown'}; mode: ${state.scene.mode}; day ${state.scene.day}`,
    `Party: ${state.players.list.map((p) => p.name).join(', ')}`,
    `Recent lines: ${recent.join(' | ')}`,
  ].join('\n')
}

/** The authored identity of an NPC, trimmed to one clause - who they are, in a handful of words. */
function identityClause(description: string, personality: unknown): string {
  const source = description.trim() ||
    (typeof personality === 'object' && personality !== null
      ? String((personality as Record<string, unknown>).summary ?? (personality as Record<string, unknown>).traits ?? '')
      : '')
  if (!source) return ''
  // First clause only. Descriptions are one or two sentences; the opening phrase is the identity
  // ("Broad-shouldered tavernkeeper who has spent two years...") and the rest is colour.
  const clause = source.split(/[.;]|\s+-\s+/)[0].trim()
  return clause.length > 90 ? `${clause.slice(0, 88).replace(/[,\s]+$/, '')}...` : clause
}

/**
 * The cast, as data: who is in this scene, who else exists, and who cannot appear at all.
 *
 * Replaces two prose blocks (`castRosterLine` + `deadRosterLine`) that spent most of their tokens
 * re-explaining the same standing rules on every single call - "spelled EXACTLY as written",
 * "CANNOT speak, act, or appear alive". Those are constants, so they moved to the narrator's
 * system prompt and what travels per call is now just the facts.
 *
 * WHO THEY ARE, not just their names (2026-07-27). A bare roster made the narrator reconstruct
 * each person from a six-line window, and once that window scrolled past their introduction it was
 * guessing: live, Warden Sef Karthen was "her attention" in one line and "his boots" nine lines
 * later, and Maren Ostler flipped inside a single sentence. The fix is the one a chatbot gets for
 * free from an unbounded history - keep the character's identity in front of the model - except
 * here it has to be re-supplied every call, because our history is truncated.
 *
 * The identity is AUTHORED data that was already sitting in `npcs.description` and
 * `npcs.personality` and simply never reached the narrator. "Corren's daughter", "Harbormistress",
 * "answers about her husband" - the referent is unambiguous once the model can see it, and it
 * costs no new column, no new authored field, and works on every NPC already in the database.
 *
 * Only the STAGED cast pays for a clause; everyone else is a name. Salience, the same way a
 * chatbot keeps the active participants in focus and lets the rest stay implicit.
 *
 * `GONE` deliberately says WHY. The old line read "Not present in the story yet", which is
 * actively wrong for someone who has just walked off and reads as "never introduced" - so a
 * narrator with the exit outside its window put her straight back in the scene.
 */
async function rosterLines(
  service: SupabaseClient,
  adventureId: string,
  state: GameState,
): Promise<string[]> {
  const npcStates = state.dm?.facts.npcStates ?? {}
  const staged = new Set(state.dialogue?.speakers?.map((sp) => sp.npcId) ?? [])
  const { data } = await service
    .from('npcs')
    .select('id, name, initial_state, description, personality')
    .eq('adventure_id', adventureId)
  const rows = ((data ?? []) as {
    id: string; name: string; initial_state: string; description: string; personality: unknown
  }[])
    .filter((n) => n.name)
    .map((n) => ({
      id: n.id,
      name: n.name,
      identity: identityClause(n.description ?? '', n.personality),
      state: npcStates[n.id] ?? n.initial_state ?? 'alive',
    }))

  const living = rows.filter((n) => n.state === 'alive')
  const here = living.filter((n) => staged.has(n.id))
  const elsewhere = living.filter((n) => !staged.has(n.id))
  const gone = rows.filter((n) => n.state !== 'alive')

  return [
    here.length > 0
      ? `HERE   ${here.map((n) => (n.identity ? `${n.name} - ${n.identity}` : n.name)).join('; ')}`
      : '',
    elsewhere.length > 0 ? `CAST   ${elsewhere.slice(0, 20).map((n) => n.name).join(', ')}` : '',
    gone.length > 0
      ? `GONE   ${gone.slice(0, 12).map((n) => `${n.name} - ${n.state === 'dead' ? 'dead' : 'not in this scene'}`).join('; ')}`
      : '',
  ].filter(Boolean)
}

/** The thread the party is actually pulling on. Read from state - no query. */
function goalLine(state: GameState): string {
  const active = state.objectives?.list?.find((o) => o.id === state.objectives?.currentId)
  return active?.title ? `GOAL   ${active.title}` : ''
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

/**
 * The living cast, spelled exactly as authored.
 *
 * `deadRosterLine` lists only the dead and absent, so a narrator that had not seen a name in the
 * last few lines was reconstructing it from memory - and live 2026-07-26 the foreman Calder became
 * "Calver's men" mid-scene. A misspelt NPC is not a cosmetic slip: NPC references elsewhere match
 * by name, so the wrong spelling is a person who does not exist.
 *
 * Cheap and bounded (an adventure has a handful of NPCs), and it is the "code supplies the
 * information" fix rather than an instruction the model has to remember.
 */
async function castRosterLine(
  service: SupabaseClient,
  adventureId: string,
  npcStates: Record<string, string>,
): Promise<string> {
  const { data } = await service
    .from('npcs')
    .select('id, name, initial_state')
    .eq('adventure_id', adventureId)
  const living = ((data ?? []) as { id: string; name: string; initial_state: string }[])
    .filter((n) => (npcStates[n.id] ?? n.initial_state ?? 'alive') === 'alive')
    .map((n) => n.name)
    .filter(Boolean)
  if (living.length === 0) return ''
  return `\nPeople in this story, spelled EXACTLY as written - never alter or approximate a name: ${living.join(', ')}.`
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
  // This session's story has ended - the epilogue was the last thing the player should read.
  // The ending itself publishes directly (see updateEndings), so it is never suppressed here.
  if (state.dm?.story?.endedSessionId && state.dm.story.endedSessionId === sessionId) {
    await logEvent(service, env.adventureId, sessionId, 'narration_suppressed', {
      reason: 'session_story_ended', prompt: prompt.slice(0, 140),
    }).catch(() => {})
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    return ''
  }
  // CONCURRENT NARRATION (2026-07-28). Once kickTail has fired, a second narrator is drafting the
  // next scene in another worker. Neither can see the other, so whichever lands second contradicts
  // the first about where the party is standing - measured at 7 of 95 pairs by the continuity
  // probe, every one 0.39-6.65s apart and in two different narrator styles.
  //
  // Reported, not blocked. WHICH call sites publish after the kick is exactly what is not known
  // (evaluateStoryProgress has 11 callers), and suppressing a line on a guess trades a
  // contradiction for a hole in the story. This names the offenders so the fix can be precise.
  if (env.tailKicked) {
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'narration_after_tail_kick', style, prompt: prompt.slice(0, 120),
    }).catch(() => {})
  }
  const npcStates = state.dm?.facts.npcStates ?? {}
  // CANON ONLY for the checker (Phase 6). It used to receive the live transcript plus the
  // generating prompt verbatim - so a draft that correctly followed its instruction was flagged as
  // contradicting it, blocked, regenerated under a NEVER: constraint quoting the very thing it was
  // asked to write, and on the second failure published the mechanical fallback. See canon.ts.
  //
  // `canon.story` is the other half of that split and it goes to the NARRATOR (2026-07-27): the
  // forces at work, what the party has already achieved, what is on a clock. Withholding it left
  // the fact-checker better informed about the story than its author.
  const canon = await buildCanon(service, env.adventureId, state)
  const [roster, profiles, memories] = await Promise.all([
    rosterLines(service, env.adventureId, state),
    partyProfileLines(service, await loadPartyCharacters(service, env.adventureId)),
    // Retrieval memory (Slice 7): long-form cutscenes ground on what past sessions established.
    style === 'exposition' ? retrieveMemories(service, env, prompt) : Promise.resolve([]),
  ])

  // LABELLED DATA, NOT PROSE (2026-07-27). This block used to be four paragraphs of English that
  // re-taught the narrator its own standing rules on every call. Those rules are constant, so they
  // moved into the system prompt and only the facts travel per turn - which paid for the three
  // things that were missing (the goal, who the cast ARE, the story so far) without the prompt
  // getting bigger.
  const grounded = [
    prompt,
    '',
    `SCENE  ${state.scene.locationName || 'unknown'} | ${state.scene.mode} | day ${state.scene.day}`,
    goalLine(state),
    ...roster,
    canon.story,
    profiles.length > 0 ? `PARTY  ${profiles.join(' // ')}` : '',
    `LAST   ${agentContextLines(state, 6).join(' | ')}`,
    memories.length > 0 ? `EARLIER ${memories.join(' // ')}` : '',
  ].filter(Boolean).join('\n')

  let text: string
  try {
    text = await runNarrator(env, grounded, undefined, style)
    text = await claimGuard(service, env, sessionId, text, canon, (constraint) =>
      runNarrator(env, grounded, constraint, style))
    text = await outcomeGuard(service, env, sessionId, text, state, (constraint) =>
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
    // LAST, deliberately: every regeneration above can introduce characters of its own, so this
    // has to be the final thing that touches the text before it is published.
    text = await charsetGuard(service, env, sessionId, text, (constraint) =>
      runNarrator(env, grounded, constraint, style))
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
  // `style` rides along so length can be judged per style (2026-07-27). Without it the measured
  // 868-char median mixes 2-4-sentence beats with 4-8-sentence cutscenes, and "are beats too long?"
  // has no answer - which is precisely why a length ceiling could not be set responsibly.
  await logEvent(service, env.adventureId, sessionId, 'narration_published', { text, style })
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
