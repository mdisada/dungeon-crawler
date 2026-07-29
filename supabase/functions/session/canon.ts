// Durable canon (overhaul Phase 6): what is TRUE about the world, as distinct from what was
// recently SAID about it or what a draft was just told to write.
//
// The consistency checker used to be handed both. `factSheet` put the live transcript under
// "Recent lines", and publishNarration appended "The draft was instructed to: <prompt>" - so a
// narrator told to continue along a direction wrote exactly that, and the checker then saw the
// identical sentence as both an established Fact and the Draft under review. It dutifully
// reported a contradiction with itself:
//
//   claim:        "two figures emerge from the oppressive blackness..."
//   conflictsWith "two figures emerge from the oppressive blackness"
//
// parseConsistency forces ok:false whenever violations exist, so that self-conflict blocked the
// draft, forced a regeneration under a NEVER: constraint quoting the thing it was asked to
// write, and on the second failure emitted consistency_double_failure and published the
// mechanical fallback line. Players saw "The attempt is resolved; the outcome stands."
//
// The split: the NARRATOR still gets everything (prompt, transcript, memories, party profiles -
// it needs them to write well). The CHECKER gets only canon: things that would still be true if
// nobody had said anything this scene.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { deadlinePressureLines, parseDeadlineRecords } from '../_shared/story/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import { scenePropsHere } from './npc-state.ts'

/**
 * A fact a draft can genuinely CONTRADICT. Only restrictions are citable as grounds for
 * blocking - context (where the party is, who the PCs are, who is alive) grounds the writing
 * but can never be violated by adding to it. Making that distinction structural is what stops
 * "Elias Thorne is not in the party" from silencing the narrator.
 */
export interface CanonRestriction {
  id: string
  text: string
}

export interface Canon {
  /** The fact sheet the consistency checker validates drafts against. */
  text: string
  /**
   * The closed menu of things a violation may cite. Empty = nothing is contradictable, and
   * runConsistency skips the LLM pass entirely.
   *
   * As of 2026-07-23 this is ALWAYS empty for narration and dialogue: committed flags were the
   * only source and they proved to be 14-for-14 false positives across three paid runs (see
   * below). Prose consistency is therefore enforced structurally - dead and absent NPCs cannot
   * speak (runConsistency's draftIsNpcSpeech pass, deterministic and still active), and flags
   * can only be written by applyMilestones. Re-populate this list the moment a restriction
   * exists that a model can actually adjudicate: a proposition, not a de-slugified fragment.
   */
  restrictions: CanonRestriction[]
  /** Live NPC states, for the deterministic dead-speaker precheck. */
  npcStates: Record<string, string>
  npcs: { id: string; name: string }[]
  /**
   * The durable world facts a WRITER needs, compressed to one line per category (2026-07-27).
   *
   * Everything below was already assembled here and handed only to the fact-checker, so the
   * narrator wrote without knowing what the story had established - which named forces exist,
   * what the party has already achieved, what is on a clock. It then invented over the gaps:
   * live 2026-07-27 an investigation success declared "Miregate isn't a location; it's a
   * ledger-system", contradicting the town the adventure opens in, because nothing in its prompt
   * said what Miregate was.
   *
   * The context/restriction split this file exists for was right; the context half just ended up
   * on the wrong side of it. Empty when there is nothing established yet.
   */
  story: string
}


/**
 * THE STORY SO FAR, IN THE WORDS THE GUIDE WROTE FOR IT (2026-07-29).
 *
 * Every story node carries an `outcome_summary` - one present-tense sentence per tier, authored
 * expressly as "the record every later scene reads instead of guessing". Until now it reached
 * exactly two places: the resolution narration itself, and the arrival bridge into the next node.
 * The STANDING context a narrator gets on every other turn had only de-slugged flag names
 * ("foundry operations exposed"), which is a fragment, not a fact.
 *
 * That is the gap behind the contradiction class. Run bac9f4b9: the party opened a chest and read
 * the parchment inside at narration #2, and at #5 the same chest "remains stubbornly closed, its
 * true contents a mystery". Nothing in the prompt said otherwise, because what happened was only
 * ever in the transcript window, and the window had moved on.
 *
 * Newest last, so the most recent state of the world reads closest to the instruction. Capped:
 * this grows with every scene played and a long session should not spend its whole budget here.
 */
const MAX_ESTABLISHED = 8

async function establishedSoFar(service: SupabaseClient, adventureId: string): Promise<string[]> {
  const { data: events } = await service
    .from('event_log')
    .select('payload')
    .eq('adventure_id', adventureId)
    .eq('type', 'encounter_resolved')
    .order('id', { ascending: true })
  const resolved = ((events ?? []) as { payload: { node_key?: string; tier?: string } }[])
    .flatMap((e) => (e.payload?.node_key ? [{ key: e.payload.node_key, tier: e.payload.tier }] : []))
  if (resolved.length === 0) return []

  const { data: nodes } = await service
    .from('story_nodes')
    .select('key, outcome_summary')
    .eq('adventure_id', adventureId)
    .in('key', [...new Set(resolved.map((r) => r.key))])
  const byKey = new Map(
    ((nodes ?? []) as { key: string; outcome_summary: { win?: string; loss?: string } | null }[])
      .map((n) => [n.key, n.outcome_summary]),
  )

  const lines: string[] = []
  for (const r of resolved) {
    const summary = byKey.get(r.key)
    // The tier that actually happened - a scene the party LOST establishes its loss sentence.
    const text = r.tier === 'full' ? summary?.win : summary?.loss
    const trimmed = typeof text === 'string' ? text.trim() : ''
    // Same scene resolving twice (re-opens happen) must not say the same thing twice.
    if (trimmed && !lines.includes(trimmed)) lines.push(trimmed)
  }
  return lines.slice(-MAX_ESTABLISHED)
}


/**
 * WHAT IS IN THIS ROOM, as the guide wrote it (2026-07-29).
 *
 * 72% of folded player inputs are questions and examinations - "what's the pounding", "what's in
 * the chest", "what did the notice say". A location carried ONE sentence (measured: 134 chars
 * each), so there was nothing for the narrator to read and it invented; the invention was recorded
 * nowhere, so the next turn dropped it or re-invented it differently. Authoring the features turns
 * an examination from an invention into a LOOKUP, which is the only version of this that can be
 * consistent.
 *
 * Only the party's CURRENT location - the rooms they are not standing in are not theirs to see,
 * and that is the same rule pickReveal follows.
 */
async function hereFeatures(
  service: SupabaseClient,
  adventureId: string,
  locationId: string | null,
): Promise<string> {
  if (!locationId) return ''
  const { data } = await service
    .from('locations')
    .select('features')
    .eq('adventure_id', adventureId)
    .eq('id', locationId)
    .maybeSingle()
  const raw = (data?.features ?? []) as unknown
  const feats = (Array.isArray(raw) ? raw : []).flatMap((f) => {
    if (typeof f !== 'object' || f === null) return []
    const o = f as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const detail = typeof o.detail === 'string' ? o.detail.trim() : ''
    return name && detail ? [`${name} - ${detail}`] : []
  })
  return feats.length > 0 ? feats.slice(0, 6).join('; ') : ''
}

/**
 * Durable world facts only. Deliberately EXCLUDES: recent dialogue lines, the generating
 * prompt, retrieved memories (prose summaries, not verified state), and anything an agent
 * proposed this turn.
 */
export async function buildCanon(
  service: SupabaseClient,
  adventureId: string,
  state: GameState,
): Promise<Canon> {
  const npcStates = state.dm?.facts.npcStates ?? {}
  const { data: npcRows } = await service
    .from('npcs')
    .select('id, name, initial_state')
    .eq('adventure_id', adventureId)
  const rows = ((npcRows ?? []) as { id: string; name: string; initial_state: string | null }[])

  // The party line MUST say what it is. Written as a bare "Party: Bram, Kestrel, Dain" the
  // checker read it as an exhaustive cast list and flagged every NPC action as a contradiction
  // ("Elias Thorne is not in the party") - 10 blocks and 3 mechanical fallbacks in one 50-turn
  // run (live 2026-07-23). Naming the living NPCs and stating that new faces are allowed turns
  // a closed world back into an open one.
  const living = rows
    .filter((n) => (npcStates[n.id] ?? n.initial_state ?? 'alive') === 'alive')
    .map((n) => n.name)
    .filter(Boolean)
  const lines = [
    `Location: ${state.scene.locationName || 'unknown'}; mode: ${state.scene.mode}; day ${state.scene.day}`,
    `PLAYER characters (the party): ${state.players.list.map((p) => p.name).join(', ') || 'none'}`,
  ]
  if (living.length > 0) {
    lines.push(`Living NPCs who may appear, speak and act: ${living.slice(0, 20).join(', ')}.`)
  }
  lines.push(
    'The lists above are not exhaustive: NPCs are not party members, and new or unnamed people ' +
      '(passers-by, crowds, someone just introduced) may appear freely. Only the DEAD/absent ' +
      'lines below are restrictions.',
  )

  // The dead are not described as PEOPLE here at all - their bodies are props in the world
  // (npc-state.ts), and a prop is a thing, not an agent. That is what stops a checker reading
  // "the fallen agents lie sprawled" as the dead ACTING: there is no dead person in the fact
  // sheet to act, only an object to describe. Absent NPCs DO stay listed as people - they are
  // still agents, just elsewhere.
  const restrictions: CanonRestriction[] = []
  const absent = rows
    .filter((n) => (npcStates[n.id] ?? n.initial_state ?? 'alive') === 'absent')
    .map((n) => n.name)

  // Named things that are NOT people or places: factions, forces, phenomena. They live in the
  // stage-1 registry and are never materialized as rows, precisely because they have no life
  // state, disposition or staging slot to give them. Canon is where they are referenced.
  const { data: adventureRow } = await service
    .from('adventures')
    .select('meta_loop')
    .eq('id', adventureId)
    .maybeSingle()
  const registry = ((adventureRow?.meta_loop as { entities?: { kind: string; name: string; note: string }[] } | null)
    ?.entities ?? []).filter((e) => e.kind === 'lore')
  const loreText = registry.map((e) => `${e.name} (${e.note})`).join('; ')
  // NAMES TRAVEL, NOTES DO NOT (2026-07-28). A lore note is the DM's briefing on what a force
  // MEANS, and the narrator was being handed the whole registry with "name and describe them
  // freely". In run 1de855de the notes were "the family that has held the harbourmaster's position
  // for three generations, bound to the ledger's upkeep" and "the Collector will settle all debts
  // if the ledger reaches 448 entries" - the answers to objectives 1 and 2. Narration #11 wrote
  // them out nearly verbatim, in a scene whose whole point was that the party FAILED to get down
  // the cellar stairs, and then the scene ledger recorded `party_learned_the_ledger_must_not_reach_
  // 448_entries_tonight` off the back of it. The leak became canon, and the objective that existed
  // to reveal it opened 19 narrations later already answered, closing in 5.
  //
  // The narrator's stated need is "which named forces exist" - so it does not invent a rival
  // faction that contradicts the guide. Names alone serve that. What a force MEANS is precisely
  // what the party is playing to find out.
  // ...but a note the party has EARNED may now be spoken (2026-07-28). Withholding always was the
  // right emergency stop and the wrong resting place: it left the narrator unable to explain a
  // force even after the objective that exists to reveal it had been won.
  //
  // The gate is authored at guide time (objectives.reveals_lore, derived in lore-reveals.ts) and
  // simply read here. Failed objectives do not release anything - the party did not accomplish
  // them, so they have not earned the explanation - and a force no objective names appears in no
  // reveal list at all, which is exactly the pre-gate behaviour.
  const { data: doneObjectives } = await service
    .from('objectives')
    .select('reveals_lore')
    .eq('adventure_id', adventureId)
    .eq('reveal_state', 'completed')
    .neq('outcome', 'failed')
  const revealed = new Set(
    ((doneObjectives ?? []) as { reveals_lore: string[] | null }[]).flatMap((o) => o.reveals_lore ?? []),
  )
  const loreNames = registry
    .map((e) => (revealed.has(e.name) ? `${e.name} (${e.note})` : e.name))
    .join('; ')
  if (registry.length > 0) {
    lines.push(
      `Forces and factions at work (real parts of the world - name and describe them freely; ` +
        `they are not people and never speak): ${loreText}.`,
    )
  }

  // The clock the party agreed to. Telegraphing beats punishing: a deadline the narrator can
  // see is one it can build tension from, rather than one that arrives out of nowhere on the
  // day it expires.
  const pressure = deadlinePressureLines(
    parseDeadlineRecords(state.dm?.story?.deadlines as Json),
    state.scene.day,
  )
  if (pressure.length > 0) {
    lines.push(`Promises with a clock on them (day ${state.scene.day} today): ${pressure.join(' ')}`)
  }

  const props = await scenePropsHere(service, adventureId, state.scene.locationId ?? null)
  if (props.length > 0) {
    lines.push(`Objects here (describe freely - they are things, not people): ${props.map((p) => p.text).join('; ')}.`)
  }
  if (absent.length > 0) {
    lines.push(`Not present in the story yet: ${absent.join(', ')} - may be spoken about.`)
  }

  // Committed world flags are CONTEXT, not restrictions.
  //
  // They were restrictions, on the reasoning that a machine-verified truth is exactly the thing
  // to hold prose to. Three paid runs say otherwise: 14 blocks total, and all 14 were false -
  // 12 of them a draft AGREEING with the flag it was accused of contradicting.
  //
  //   claim:        "The Iron Hand scouts you felled lie unmoving amidst overturned crates"
  //   conflictsWith "observed iron hand scout"
  //
  // The deterministic gates cannot catch this: the model cites a real restriction id and does
  // quote the draft, so both pass. The bad judgement is inside them. And the failure scales with
  // SUCCESS - the run that finally progressed (11 milestones, up from 4) produced 12 blocks
  // where the stalled run produced none. Every fix to pacing made the checker noisier.
  //
  // The deeper error is the one this file was written to fix, one level down: a de-slugified
  // flag ("observed iron hand scout") is a fragment, not a proposition. Nothing about it tells a
  // model what would negate it, so "mentions the subject" collapses into "contradicts the fact".
  //
  // Nothing mechanical is lost. applyMilestones is the only writer of flags; prose cannot
  // un-write one, so a "contradiction" here was never going to corrupt state - it cost a
  // regeneration and bought nothing. Flags stay in the fact sheet as grounding, where a narrator
  // that has forgotten what happened can still read them.
  const trueFlags = [
    ...Object.entries(state.dm?.facts.flags ?? {}).filter(([, v]) => v === true).map(([k]) => k),
    ...Object.entries(state.dm?.facts.world ?? {}).filter(([, v]) => v === true).map(([k]) => k),
  ]
  if (trueFlags.length > 0) {
    lines.push(
      `Already true in this story (refer to these freely - they are what HAS happened, never a ` +
        `limit on what you may write): ${trueFlags.slice(0, 12).map((f) => f.replaceAll('_', ' ')).join('; ')}.`,
    )
  }

  // The restrictions appear in the fact sheet WITH their ids, so the model can see what it is
  // allowed to cite. Everything above them is context: grounding for the writing, never
  // grounds for a violation.
  const restrictionLines = restrictions.length > 0
    ? ['', 'RESTRICTIONS (the only facts a draft can contradict - cite one by id or report none):',
       ...restrictions.map((r) => `  [${r.id}] ${r.text}`)]
    : ['', 'RESTRICTIONS: none. Nothing in this scene can be contradicted.']

  // The writer's half, one labelled line per category and no instructional prose - the standing
  // rules that used to travel with this text now live in the narrator's system prompt, where they
  // are sent once instead of re-explained on every call.
  const established = await establishedSoFar(service, adventureId)
  const features = await hereFeatures(service, adventureId, state.scene.locationId ?? null)
  const story = [
    // The authored contents of the room the party is standing in. Ahead of everything else because
    // it is what a player is most likely to ask about next.
    features ? `HERE   ${features} - authored detail: use it when they look, and do NOT invent ` +
      'other fixtures or contents for this place.' : '',
    // The authored record of what has already happened, ahead of the flag list below: a sentence
    // the guide wrote beats a de-slugged fragment every time.
    established.length > 0 ? `STORY  ${established.join(' ')}` : '',
    // WHAT A FORCE IS, not just its name (2026-07-28). The fact-checker above is told that these
    // "are not people and never speak"; the narrator was handed the bare list and left to work it
    // out. It did not, and could not reasonably be expected to.
    //
    // Run 15fc82be: stage 6 correctly identified "Warden Selk" as a group rather than a person,
    // deleted the NPC row, and reclassified him to lore in both registries - the machinery worked.
    // He then reached the narrator as one more name under FORCES, and 7 of 26 narrations staged
    // him as a character, including speaking: "Selk's voice carries over the flood: a name read
    // aloud from the Ledger." A person with no row, no voice and no life state, who cannot be
    // addressed or killed or tracked.
    //
    // The qualifier is what makes the datum usable, exactly as naming the location was for the
    // beat-opening prompt. It costs one clause per narration.
    loreNames
      ? `FORCES ${loreNames} - named parts of the world, not people: they are never present as ` +
        'characters, never speak, and never act.'
      : '',
    trueFlags.length > 0 ? `DONE   ${trueFlags.slice(0, 12).map((f) => f.replaceAll('_', ' ')).join('; ')}` : '',
    pressure.length > 0 ? `CLOCK  ${pressure.join(' ')}` : '',
    props.length > 0 ? `PROPS  ${props.map((p) => p.text).join('; ')}` : '',
  ].filter(Boolean).join('\n')

  return {
    text: [...lines, ...restrictionLines].join('\n'),
    restrictions,
    npcStates,
    npcs: rows.map((n) => ({ id: n.id, name: n.name })),
    story,
  }
}
