// Narrator flows (F07 SS5.1 + SS6): outcome narration for adjudicated actions and the
// "Narrate the next story" options flow. Full-AI auto-picks option 1 - the same two proposal
// rows a human DM will click through when the console lands in Phase 10. Every draft passes
// the Consistency Manager: one constrained regeneration on violation, then the minimal
// mechanical fallback + an incident event (F15).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { foreignCharacters, stripForeign } from '../_shared/guide/charset.ts'
import { npcLocationAt } from '../_shared/guide/npc-itinerary.ts'
import type { ItineraryStop } from '../_shared/guide/npc-itinerary.ts'
import { dialogueGateActive, dmSettings } from '../_shared/play/index.ts'
import {
  stripContextEcho, takeIntroduced, trailingLabel, trimToCompleteSentence,
} from '../_shared/story/index.ts'
import type { GameState, Json, PendingReviewState } from '../_shared/state/index.ts'
import { runClaimCheck, runConsistency, runNarrator, runNarratorOptions, runOutcomeClaimCheck } from './agents.ts'
import type { AgentEnv, NarrationStyle } from './agents.ts'
import { buildCanon, nodePull } from './canon.ts'
import { retrieveMemories, writeMemoryFragment } from './memory.ts'
import {
  agentContextLines, agentContextSplit, appendLinesDiff, loadPartyCharacters, newLine,
  partyProfileLines, typingDiff,
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
 * Rollout switch for the trailing-label guard (2026-07-29, verdict 2026-07-30).
 *
 * Stays at 'shadow' on purpose, and the reason is now the upstream fix rather than doubt about the
 * check: the narrator no longer receives a quest string to paste (see `pullLine`), so this guards a
 * defect whose source has been removed. It is the backstop that tells us if a label finds its way
 * back into the prompt, not the defence.
 *
 * Its sibling MECHANICS_CHECK is gone. Shadow mode is what killed it - one honest run on the model
 * we actually ship (e87b3506, glm-5.2 narrator AND npc_agent, 30 turns) recorded ZERO hits across
 * narration and dialogue, where the flash-lite runs that motivated the word list leaked constantly.
 * Enforcing would have hidden that: a guard with no true positives and a guard that blocks nothing
 * look identical once the suspect draft never ships. The list was solving a cheap-model artifact.
 */
export const TRAILING_LABEL_CHECK: 'off' | 'shadow' | 'enforce' = 'shadow'


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
  // PRESENT IS NOT THE SAME QUESTION AS SPEAKING (2026-07-28).
  //
  // `dialogue.speakers` is the ROUTING field: whoever is in it takes absolute priority over the
  // encounter, so entry.ts deliberately refuses to stage speakers when a non-social encounter
  // opens - otherwise every subsequent input becomes NPC dialogue and starves the challenge (an
  // NPC staged into a solo search scene, seen live). That guard is right and stays.
  //
  // But HERE was reading that same field to answer a different question - who is in this scene -
  // so a combat or skill challenge with an authored cast told the narrator its cast was
  // ELSEWHERE. Run 15fc82be had zero social encounters across 26 narrations, so HERE was empty
  // for every single one and every NPC in the story was described to the narrator as absent,
  // including the boss the party was fighting.
  //
  // The node already records who it stages. Reading presence from there leaves routing untouched.
  const params = state.dm?.encounterSpec?.params
  const encounterCast = (typeof params === 'object' && params !== null && !Array.isArray(params) &&
      Array.isArray((params as Record<string, unknown>).npc_ids)
    ? ((params as Record<string, unknown>).npc_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : [])
  const staged = new Set([
    ...(state.dialogue?.speakers?.map((sp) => sp.npcId) ?? []),
    ...encounterCast,
  ])
  const { data } = await service
    .from('npcs')
    .select('id, name, initial_state, description, personality, itinerary')
    .eq('adventure_id', adventureId)
  // WHERE THE CAST ARE (2026-07-28). `CAST` listed bare names, so the narrator knew who existed
  // and never where any of them were - it could not say "Pell is over at the Drowned Quarter"
  // because nothing told it. npcs.itinerary is derived at guide time from the nodes that stage
  // each character, so this is a lookup, not a judgement.
  const { data: objectiveRows } = await service
    .from('objectives')
    .select('id, index')
    .eq('adventure_id', adventureId)
  const objectiveIndex = ((objectiveRows ?? []) as { id: string; index: number }[])
    .find((o) => o.id === state.objectives?.currentId)?.index ?? -1
  const { data: locationRows } = await service
    .from('locations')
    .select('id, name')
    .eq('adventure_id', adventureId)
  const locationName = new Map(((locationRows ?? []) as { id: string; name: string }[])
    .map((l) => [l.id, l.name]))

  const rows = ((data ?? []) as {
    id: string; name: string; initial_state: string; description: string; personality: unknown
    itinerary: ItineraryStop[] | null
  }[])
    .filter((n) => n.name)
    .map((n) => ({
      id: n.id,
      name: n.name,
      identity: identityClause(n.description ?? '', n.personality),
      state: npcStates[n.id] ?? n.initial_state ?? 'alive',
      // Null before their first stop, and left null rather than guessed - see npc-itinerary.ts.
      // The narrator is told where someone is only when the guide actually placed them.
      where: locationName.get(npcLocationAt(n.itinerary ?? [], objectiveIndex) ?? '') ?? '',
    }))

  const living = rows.filter((n) => n.state === 'alive')
  const here = living.filter((n) => staged.has(n.id))
  const elsewhere = living.filter((n) => !staged.has(n.id))
  const gone = rows.filter((n) => n.state !== 'alive')

  return [
    here.length > 0
      ? `HERE   ${here.map((n) => (n.identity ? `${n.name} - ${n.identity}` : n.name)).join('; ')}`
      : '',
    elsewhere.length > 0
      ? `CAST   ${elsewhere.slice(0, 20).map((n) => (n.where ? `${n.name} (at ${n.where})` : n.name)).join(', ')}`
      : '',
    gone.length > 0
      ? `GONE   ${gone.slice(0, 12).map((n) => `${n.name} - ${n.state === 'dead' ? 'dead' : 'not in this scene'}`).join('; ')}`
      : '',
  ].filter(Boolean)
}

/**
 * WHERE THIS SCENE IS, which is not always where `state.scene` says (2026-07-28).
 *
 * A node carries the place it happens. The runtime narrates a "pull" when the party is elsewhere
 * and opens the encounter when they engage - but nothing ever moves `scene.locationId` to the
 * node, because travel is only committed when the intent mapper spots the player SAYING they
 * travel. So the fiction walks into the room and the state stays outside it.
 *
 * Run 6d9b2aeb: the party broke into the harbourmaster's office at narration #8 and every
 * narration through #21 was still stamped `Marenfleet`, thirteen scenes later. #21 then wrote
 * "somewhere beyond the quay, the Harbourmaster's office waits empty" while the party, Edric and
 * Wenna were all standing in it.
 *
 * This corrects what the NARRATOR is told, which is the half that reaches the page. It does not
 * move the party: `scene.locationId` still drives discovery, props and travel, and changing that
 * needs `setScene` and a creator id that this path does not have. The divergence is logged so the
 * remaining half is measurable rather than invisible.
 */
async function sceneLocation(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
): Promise<string> {
  const stated = state.scene.locationName || ''
  const nodeKey = state.dm?.encounterSpec?.nodeKey
  if (!nodeKey || !state.encounter) return stated || 'unknown'
  const { data } = await service
    .from('story_nodes')
    .select('location_id, locations(name)')
    .eq('adventure_id', env.adventureId)
    .eq('key', nodeKey)
    .maybeSingle()
  const actual = (data as { locations?: { name?: string } | null } | null)?.locations?.name ?? ''
  if (!actual || actual === stated) return stated || 'unknown'
  await logEvent(service, env.adventureId, sessionId, 'incident', {
    kind: 'scene_location_diverged', stated, actual, node_key: nodeKey,
  }).catch(() => {})
  return actual
}

/**
 * What the party has ALREADY LEARNED, verbatim as authored (2026-07-28).
 *
 * `ingredients.discovered` is written by exactly two gates - a passed search in the right room
 * (discovery.ts) and the reveal gate inside a conversation (npc-dialogue.ts) - so it is a precise
 * record of what this party has earned, and nothing else. That makes it the one source that can
 * be handed over whole without leaking: an undiscovered clue is simply not in it.
 *
 * It answers the case retrieval handles badly. A player asking "what did that ledger page say?"
 * two scenes later needs the AUTHORED text, not a semantic neighbour of it - memories are
 * embeddings of scene summaries and will paraphrase, or miss. This is the exact sentence.
 */
async function knownLine(service: SupabaseClient, adventureId: string): Promise<string> {
  const { data } = await service
    .from('ingredients')
    .select('reveals')
    .eq('adventure_id', adventureId)
    .eq('discovered', true)
  const facts = ((data ?? []) as { reveals: string | null }[])
    .map((r) => (r.reveals ?? '').trim())
    .filter(Boolean)
  return facts.length > 0 ? `KNOWN  ${facts.slice(0, 12).join(' // ')}` : ''
}

/**
 * The thread the party is actually pulling on - as a SITUATION, not a task (2026-07-30).
 *
 * `GOAL <objective title>` used to be this line, paired with the instruction "never state as a
 * task". Run e87b3506 closed five published passages on the literal sentence "Learn why the plague
 * bell tolls." and wove "The truth in Voss's cellar waits" into a sixth - so the instruction lost,
 * as an instruction contradicting its own input always will. The fix is not a stronger instruction
 * or a stricter strip: it is to stop handing a prose writer a quest string.
 *
 * `pull` is authored by the guide for exactly this slot - one present-tense sentence about the
 * unresolved thing in the world. Echoing it verbatim is harmless, which is the whole point.
 *
 * Falls back to the title when no node is open or the guide never authored one, so behaviour is
 * unchanged for the 23 guides that predate the column.
 */
function goalLine(state: GameState, pull: string): string {
  if (pull) return `PULL   ${pull}`
  const title = goalTitle(state)
  return title ? `GOAL   ${title}` : ''
}

/** The active objective's title on its own - also one of the labels the trailing-label guard
 *  refuses to let the narrator paste on as a closing sentence. */
function goalTitle(state: GameState): string {
  const active = state.objectives?.list?.find((o) => o.id === state.objectives?.currentId)
  return typeof active?.title === 'string' ? active.title : ''
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
  const [roster, profiles, memories, flavour, known, whereWeAre, pull] = await Promise.all([
    rosterLines(service, env.adventureId, state),
    partyProfileLines(service, await loadPartyCharacters(service, env.adventureId)),
    // Retrieval memory (Slice 7): ground on what past sessions established.
    //
    // UNGATED (2026-07-28). This ran only for `exposition`, so the two styles that answer a player
    // ASKING about something - "what was that ledger we found?" - got no memory at all. `outcome`
    // narrates the result of a player's action and `beat` opens on what they can engage with;
    // those are exactly the moments recall matters, and they were the ones excluded.
    //
    // One embedding call per narration. It degrades to no-memories on any failure, by design.
    retrieveMemories(service, env, prompt),
    // The flavour tier, on its own small budget - see retrieveMemories' `kinds`.
    retrieveMemories(service, env, prompt, 3, ['flavour']),
    knownLine(service, env.adventureId),
    sceneLocation(service, env, sessionId, state),
    // The open node's authored orientation line. Empty on a legacy guide or between nodes, and
    // goalLine falls back to the objective title exactly as it did before.
    nodePull(service, env.adventureId, state.dm?.encounterSpec?.nodeKey ?? null).catch(() => ''),
  ])

  // LABELLED DATA, NOT PROSE (2026-07-27). This block used to be four paragraphs of English that
  // re-taught the narrator its own standing rules on every call. Those rules are constant, so they
  // moved into the system prompt and only the facts travel per turn - which paid for the three
  // things that were missing (the goal, who the cast ARE, the story so far) without the prompt
  // getting bigger.
  // TWELVE LINES, NOT SIX (2026-07-28). `recent` counts LINES - narrations and player utterances
  // interleaved - so six was roughly the last two or three exchanges. The narrator forgot things
  // that were still on the same page.
  //
  // Run 6d9b2aeb introduced "a woman in a customs officer's grey tunic" at narration #2; by #6,
  // four narrations and their player turns later, she had aged out of the window and the narrator
  // wrote "the man you watched hauling a sagging canvas sack". Nothing tracks walk-ons - they have
  // no row and never will - so the transcript is the only thing that remembers them, and it did
  // not reach far enough back.
  //
  // Twelve is not a guess: it is what an NPC already gets (npc-dialogue.ts passes 12 to
  // agentContextLines). The narrator, which writes the story, had half the working memory of a
  // single character in it. The extra cost is a few hundred tokens on a call that already carries
  // canon, roster, party profiles and memories.
  const transcript = agentContextSplit(state, 12)
  const grounded = [
    prompt,
    '',
    `SCENE  ${whereWeAre} | ${state.scene.mode} | day ${state.scene.day}`,
    goalLine(state, pull),
    ...roster,
    canon.story,
    profiles.length > 0 ? `PARTY  ${profiles.join(' // ')}` : '',
    // SOFAR and LAST are separate fields because they answer separate questions: what has happened
    // across the story, and what was said a moment ago. Joined into one LAST they became peers in a
    // pipe-separated run-on, six phases ago sitting beside one second ago.
    transcript.digests.length > 0 ? `SOFAR  ${transcript.digests.join(' // ')}` : '',
    `LAST   ${transcript.recent.join(' | ')}`,
    known,
    memories.length > 0 ? `EARLIER ${memories.join(' // ')}` : '',
    // Labelled as colour ON PURPOSE. These are details the narration invented, not authored plot,
    // and the whole point of the tier is that nothing downstream mistakes one for the other. Keep
    // them consistent when they come up; never build the story on them.
    flavour.length > 0
      ? `COLOUR ${flavour.join(' // ')} - detail from earlier play. Stay consistent with it if it ` +
        'comes up, and never treat it as plot or let it drive what happens next.'
      : '',
  ].filter(Boolean).join('\n')

  let text: string
  try {
    text = await runNarrator(env, grounded, undefined, style)
    // THE BRIEFING IS NOT THE STORY (2026-07-29). The labelled block above is what we pay to send;
    // a weak model can treat it as a document to continue and copy it back. Measured at 3 of 348
    // published lines - one player was shown `CAST Dorya Salk - female Mirefleet resident...`
    // followed by PARTY, SOFAR and LAST. Deterministic and shape-based; see the module header for
    // why it never strips a lone `LAST` and never returns an empty narration.
    // WHAT IT INVENTED, taken before anything else touches the text (2026-07-29). Stripping first
    // means every guard below sees clean prose, and `NEW` is also one of stripContextEcho's hard
    // labels as a second line of defence.
    const invented = takeIntroduced(text)
    text = invented.text
    if (invented.introduced.length > 0) {
      // FLAVOUR canon: remembered so the world stays consistent, structurally unable to reach state
      // (memory_fragments is retrieved as prose; applyMilestones is the only writer of flags and
      // facts). Fire-and-forget - the player never waits on bookkeeping, and a lost fragment costs
      // consistency, never the turn.
      void writeMemoryFragment(service, env, 'flavour', invented.introduced.join('; '))
      await logEvent(service, env.adventureId, sessionId, 'flavour_recorded', {
        introduced: invented.introduced, style,
      }).catch(() => {})
    }
    const echo = stripContextEcho(text)
    if (echo.stripped.length > 0) {
      text = echo.text
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'context_echo_stripped', labels: echo.stripped, style,
      }).catch(() => {})
    }
    // A HALF-SENTENCE MUST NOT REACH THE PLAYER (2026-07-29). llm.ts retries when the provider
    // reports finish_reason 'length', and its own comment records that this provider does not
    // report it reliably - so run bac9f4b9 published a narration ending on the words "The
    // secrets". Shape-based, because a model cannot be asked to notice it was cut off.
    // A MACHINE LABEL IS NOT A CLOSING SENTENCE (2026-07-29). stripContextEcho catches fixed tokens
    // (CAST, PARTY, SOFAR) and cannot catch these, because an encounter label is a different string
    // every adventure. Three narrations in run abd318e1 ended with the literal sentence "Earn Netta
    // Vasch's trust." We know the strings at call time, so the check is free - and it only fires on
    // a label standing as the passage's own final sentence, never one described mid-prose.
    // `encounterSpec` carries no label of its own - the open encounter and the objective are the
    // two machine-facing titles a narration can paste on.
    const labels = [state.encounter?.label ?? '', goalTitle(state)]
      .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    const pasted = TRAILING_LABEL_CHECK === 'off' ? null : trailingLabel(text, labels)
    if (pasted) {
      const cut = text.trim().slice(0, text.trim().toLowerCase().lastIndexOf(pasted.toLowerCase().slice(0, 8))).trim()
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'trailing_label_stripped', label: pasted, style,
        enforced: TRAILING_LABEL_CHECK === 'enforce' && cut.length >= 40,
      }).catch(() => {})
      if (TRAILING_LABEL_CHECK === 'enforce' && cut.length >= 40) text = cut
    }
    const whole = trimToCompleteSentence(text)
    if (whole.trimmed) {
      text = whole.text
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'narration_truncated_trimmed', style,
      }).catch(() => {})
    }
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

  // RE-CHECK AT WRITE TIME, NOT LOAD TIME (2026-07-28). The `endedSessionId` guard at the top of
  // this function reads state from BEFORE the narrator ran, and the narrator runs for 9-33s. A
  // scene that began drafting while the story was still live published 5.4s AFTER
  // `adventure_ended` in run 0bcf6d87 - the player read the epilogue, then a new scene opened
  // under it. `narration_suppressed` was 0 for that run: the guard is not weak, it is early.
  //
  // commitDiffs re-loads state for the builder and retries on stale versions, so the builder is
  // the only place in this function that sees the state the write actually lands on.
  // THE PARTY MOVED WHILE THIS WAS BEING WRITTEN (2026-07-28). Same shape as the guard above and
  // the same root cause: this function grounds a draft in state loaded 9-33s before it publishes.
  //
  // The tail runs in its own worker with `typing` released - deliberately, because holding it
  // rejected 6 of 26 turns as 409s - so a request can kick its tail and go on publishing, and two
  // narrations land out of order. Run 1d405957 published these one second apart:
  //
  //   #3  "Rasmund Cawl hunches over his desk... sees you standing in his doorway."
  //   #4  "the office, twenty paces away, sits slightly ajar... no sound comes from within."
  //
  // `scene_travel` fired between them. #4 is the beat-opening pull and its CONTENT IS CORRECT -
  // the party genuinely had not arrived when it was drafted. It describes a place they had left
  // by the time it reached the page.
  //
  // A NOTE ON THE TRADEOFF, because it reverses an earlier judgement in this file: the concurrent-
  // narration comment above chose to report rather than block, on the grounds that suppressing a
  // line "trades a contradiction for a hole in the story". That was right while the offender was
  // unknown and any guard would have been a guess. It is now known and narrow - only a draft whose
  // scene MOVED under it is dropped, which cannot happen unless the party is somewhere else. A
  // missing line reads as pace; a line placing the party twenty paces from a room they are
  // standing in reads as broken. Both locations are logged, so if this proves to cut real
  // narration the evidence to reverse it will be in the record rather than in an argument.
  const draftedAtLocation = state.scene.locationId ?? null
  let suppressed: string | null = null
  await commitDiffs(service, env.adventureId, (s) => {
    // Reset per attempt: commitDiffs re-runs this builder on a stale-version retry, and a verdict
    // carried over from a previous attempt would report a line as suppressed that this attempt
    // just appended.
    suppressed = null
    if (s.dm?.story?.endedSessionId && s.dm.story.endedSessionId === sessionId) {
      suppressed = 'story_ended_during_generation'
    } else if ((s.scene.locationId ?? null) !== draftedAtLocation) {
      suppressed = 'scene_moved_during_generation'
    }
    if (suppressed) return [typingDiff(false)]
    return [appendLinesDiff(s, [newLine(null, null, text)]), typingDiff(false)]
  })
  if (suppressed) {
    await logEvent(service, env.adventureId, sessionId, 'narration_suppressed', {
      reason: suppressed, style, prompt: prompt.slice(0, 140),
      drafted_at_location: draftedAtLocation, text: text.slice(0, 200),
    }).catch(() => {})
    return ''
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
  // `style` rides along so length can be judged per style (2026-07-27). Without it the measured
  // 868-char median mixes 2-4-sentence beats with 4-8-sentence cutscenes, and "are beats too long?"
  // has no answer - which is precisely why a length ceiling could not be set responsibly.
  // THE PROMPT RIDES ALONG (2026-07-28). Diagnosing why a narration said what it said meant
  // reading the code path and inferring the prompt, because only the OUTPUT was recorded - and
  // that inference is exactly where a day's worth of wrong theories came from. When run 286cf89e
  // killed an NPC the guide never killed, the question "what was the narrator actually asked?"
  // could not be answered from the record at all.
  //
  // Truncated because the instruction is the actionable part; the surrounding context window is
  // rebuildable from state, and storing it per narration would dwarf every other payload here.
  // `location` too: only the INSTRUCTION is stored, not the whole grounded context, so "where did
  // the runtime think the party was?" was unanswerable from the record - and that was the exact
  // question behind narration #19 of run 15fc82be inventing a location. One field, and the class
  // of bug where prose and state disagree about place becomes checkable without a code read.
  await logEvent(service, env.adventureId, sessionId, 'narration_published', {
    text, style, prompt: prompt.slice(0, 2000), location: whereWeAre,
  })
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
