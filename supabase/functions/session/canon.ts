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
  if (registry.length > 0) {
    lines.push(
      `Forces and factions at work (real parts of the world - name and describe them freely; ` +
        `they are not people and never speak): ${registry.map((e) => `${e.name} (${e.note})`).join('; ')}.`,
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

  return {
    text: [...lines, ...restrictionLines].join('\n'),
    restrictions,
    npcStates,
    npcs: rows.map((n) => ({ id: n.id, name: n.name })),
  }
}
