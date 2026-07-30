// Authored story graph - node shape, parse, and chapter-local validation (story-engine
// overhaul, 2026-07-26). A `story_node` is what a runtime beat used to be, moved to guide time:
// the same typed encounter spec, plus the authored transitions and affordances that let the
// runtime NAVIGATE the graph instead of PLAN a fresh beat every turn.
//
// This module owns the DATA SHAPE and its structural validity (per-node parse + chapter-local
// graph checks used for stage-5 retry feedback). The whole-adventure reachability gate lives in
// graph.ts and reuses the tier/atom helpers here. Nothing here calls an LLM: code owns the
// skeleton, the model only fills prose into the slots.

import { Check } from './json.ts'
import { canonicalizeAtomSlug, resolveAtomText } from '../story/atoms.ts'
import type { AtomProposal, AtomKind } from '../story/atoms.ts'
import { ENCOUNTER_KINDS } from '../story/beats.ts'
import type { BeatEncounterKind, BeatEncounterSpec, OutcomeMaps } from '../story/beats.ts'
import { parseOutcomeMaps } from '../story/beats.ts'
import type { Json } from '../state/types.ts'

export type NodeKind = BeatEncounterKind
export type NodeRole = 'route' | 'rescue'

/** The resolution tiers an encounter ends on - the exact strings resolveOpenEncounter selects a
 *  map with, so a transition keys straight off the outcome. */
/** Pass or fail (owner decision, 2026-07-27) - see story/navigate.ts for why `partial` went. */
export const TRANSITION_TIERS = ['full', 'failed'] as const
export type TransitionTier = (typeof TRANSITION_TIERS)[number]

export interface NodeAffordance {
  /** Stable slug the chip and the closed-menu entry mapper key off. */
  key: string
  /** Player-facing chip text - the authored hint, verbatim. See affordanceLabel for why code no
   *  longer prefixes the scene's verb. */
  label: string
  /** One-line hint - the authored flavor. */
  hint: string
}

export interface NodeTransition {
  on: TransitionTier
  /** The node to play next on this tier, or null = no further node within this objective (the
   *  objective either completed via outcome atoms, or route-health takes over). */
  toNodeKey: string | null
  /** Tier-aware "how they arrive" line for the narrator. Required on partial/failed edges into a
   *  node so a setback is never narrated from the destination's success-flavored seed. */
  arrivalContext: string
}

export interface StoryNodeSpec {
  key: string
  objectiveKey: string
  index: number
  kind: NodeKind
  role: NodeRole
  label: string
  narrationSeed: string
  /**
   * WHERE this node happens - a key from the chapter's location list, or null when the guide has
   * no locations to choose from (legacy adventures, and the rescue nodes code materializes).
   *
   * Authored from a CLOSED vocabulary and validated on parse, the same contract `npcKeys` uses.
   * Which place a scene occupies is a fiction decision, so the model makes it; the closed list is
   * what stops the answer being wrong. The runtime reads this to tell "the party is standing here"
   * from "the party has not gone there yet" instead of inferring it from prose.
   */
  locationKey: string | null
  /**
   * What is TRUE once this node resolves - one present-tense sentence per outcome.
   *
   * `narrationSeed` says what the scene opens on and `stakes` says what is at risk; neither says
   * what the world looks like afterwards. Without that, nothing downstream can know the state a
   * played scene left behind, and an objective's routes - authored as parallel alternatives but
   * PLAYED as a ladder, each reached by failing the one before - get written against an untouched
   * world. That is the shape behind both contradictions in guide 350c0363.
   *
   * Empty strings mean "not authored": the guide still ships and behaves as it did before.
   */
  outcomeSummary: { win: string; loss: string }
  /**
   * WHY THE PARTY IS STILL HERE, in the fiction - the narrator's orientation line (2026-07-30).
   *
   * The narrator used to be handed `GOAL <objective title>` and told "never state as a task". It
   * stated it as a task anyway: run e87b3506 closed five passages on the literal sentence "Learn why
   * the plague bell tolls." and wove "The truth in Voss's cellar waits" into a sixth. That is not a
   * model failing to follow an instruction so much as an instruction at war with itself - "orient to
   * this string, never say this string" - where the cheapest way to satisfy the first half is to say
   * it. A quest title is UI copy; handing it to a prose writer as a directive is the bug.
   *
   * So the guide authors the orientation instead: one present-tense sentence naming the unresolved
   * thing in the world, not the task. "The tower stair is gated and Mother Solla keeps the key" -
   * never "Learn why the bell tolls". Pasting THIS verbatim costs nothing, because it already reads
   * as prose about the room.
   *
   * NOT player-facing on its own and not a spoiler channel: it may only name what the party can
   * already see or has already been told. The objective title stays the player's signpost in the
   * sidebar; this is what the narrator writes from.
   *
   * Empty string means "not authored" - the narrator falls back to the objective title exactly as
   * before, so the 23 existing guides keep working untouched. Same contract `outcomeSummary` uses.
   */
  pull: string
  /**
   * The plot fact this beat MAKES TRUE when it resolves - at ANY tier (2026-07-29).
   *
   * DERIVED, never authored: it is the objective's minimal satisfying set, exactly as `onSuccess`
   * used to be. Only where it is credited has changed.
   *
   * Why it moved out of `onSuccess`: measured across 103 nodes in 12 guides, 103 of 103 had an
   * `onSuccess` atom their objective needed to complete and 103 of 103 credited no plot atom on
   * failure - so winning the encounter WAS the plot. That contradicts the invariant: the plot is
   * prewritten and linear, and encounters change narration, rewards, price and ending-steer, never
   * whether the story advances. Live in 9a5f87a6 a party lost all three routes of objective 0 and
   * its plot atom was never written, while every setback fired: the price was recorded and the
   * fact was not.
   *
   * The outcome maps below now carry FLAVOUR ONLY. See docs/DECISIONS.md 2026-07-29.
   */
  establishes: string[]
  /** Same shape beats.encounter_spec has always used; the outcome maps are flavour writers. */
  encounter: BeatEncounterSpec
  affordances: NodeAffordance[]
  transitions: NodeTransition[]
  /** Atoms this node declares, registered into the registry (scope 'local') at authoring. */
  localAtoms: AtomProposal[]
}

/** Deterministic, stable, unique-per-adventure identity. Objective handle keeps nodes grouped. */
export function nodeKeyFor(objectiveKey: string, role: NodeRole, index: number): string {
  return `${objectiveKey}#${role === 'rescue' ? 'r' : 'n'}${index}`
}

/** Code-owned mechanical half of a chip label, by kind. The model's hint follows the colon. */
const KIND_VERB: Record<NodeKind, string> = {
  skill_challenge: 'Attempt',
  social: 'Talk',
  puzzle: 'Work out',
  combat: 'Fight',
}

/**
 * THE HINT IS THE CHIP (owner decision, 2026-07-30).
 *
 * This used to return `${KIND_VERB[kind]}: ${hint}` so the mechanical half was code-owned and a chip
 * could never contradict the spec it sat on. The cost of that guarantee turned out to be higher than
 * the guarantee: the model writes hints that already begin with a verb, so 158 of 1193 authored chips
 * (13%) reached the player doubled -
 *
 *   "Attempt: Attempt to sever the ledger's connection to the leviathan."
 *   "Fight: attempt to stop the signal"
 *   "Work out: Attempt to create a new, true entry on the spot."
 *
 * Stripping a leading verb was considered and rejected as too error-prone to run on player-facing
 * text. Removing the prefix is the simpler correct move: nothing parses the "Verb: " format - the
 * entry mapper matches on `key`, the UI renders the string as-is - so it was presentation only, and
 * the fix belongs in the authoring prompt where the phrasing is decided.
 *
 * KIND_VERB stays as the empty-hint fallback, which is the one case that still needs code to
 * guarantee a chip says something.
 */
export function affordanceLabel(kind: NodeKind, hint: string): string {
  const flavor = hint.trim()
  if (!flavor) return KIND_VERB[kind]
  // Sentence case, in code (owner, 2026-07-30). Authored hints arrive lowercase because they used to
  // sit after a "Verb:" prefix, and a chip is now a standalone line the player reads. Unlike verb
  // stripping this cannot go wrong: one character, uppercased, and a no-op on anything that is not a
  // lowercase letter. Nothing else is touched, so "Vane's" and any acronym survive intact.
  return flavor[0].toUpperCase() + flavor.slice(1)
}

/** Reads the authored `{win, loss}` pair, tolerating absence - an omitted outcome is thin, not
 *  invalid, and must never be the reason a chapter fails to generate. */
export function parseOutcomeSummary(raw: unknown): { win: string; loss: string } {
  const o = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const one = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return { win: one(o.win), loss: one(o.loss) }
}

export interface NodeParseContext {
  objectiveKey: string
  /** Registry labels (objective spine atoms) the outcome maps may draw from. */
  objectiveAtoms: string[]
}

/**
 * Parses one authored node. Outcome-map atoms resolve against the objective atoms UNION this
 * node's declared local atoms (the same closed menu the runtime two-call planner used, now
 * resolved at authoring). Transition TARGET existence is a graph property checked in
 * validateNodeGraph, not here - a single node cannot see its siblings.
 */
export function parseNodeSpec(raw: unknown, ctx: NodeParseContext): { ok: true; node: StoryNodeSpec } | { ok: false; errors: string[] } {
  const c = new Check()
  const obj = c.obj(raw, '$')
  const key = c.str(obj.key, '$.key')
  const kind = c.oneOf(obj.kind, '$.kind', ENCOUNTER_KINDS)
  const role = c.oneOf(obj.role ?? 'route', '$.role', ['route', 'rescue'] as const)
  const index = typeof obj.index === 'number' && Number.isInteger(obj.index) ? obj.index : 0
  const label = c.str(obj.label, '$.label', { allowEmpty: true }) || key
  const narrationSeed = c.str(obj.narration_seed, '$.narration_seed')

  // Local atoms (declared, kind flag|event) - the only door authoring atom creation has.
  const localAtoms: AtomProposal[] = c.arr(obj.local_atoms ?? [], '$.local_atoms', 0, 4).flatMap((a, i) => {
    const at = c.obj(a, `$.local_atoms[${i}]`)
    const name = c.str(at.name, `$.local_atoms[${i}].name`)
    const akind = c.oneOf(at.kind, `$.local_atoms[${i}].kind`, ['flag', 'event'] as const) as AtomKind
    return name ? [{ name, kind: akind }] : []
  })

  const menu = [...ctx.objectiveAtoms, ...localAtoms.map((a) => a.name)]
  const maps: OutcomeMaps = parseOutcomeMaps(
    { on_success: obj.on_success, on_partial: obj.on_partial, on_failure: obj.on_failure },
    menu,
  )

  const encounter: BeatEncounterSpec = {
    kind: kind as BeatEncounterKind,
    label,
    stakes: c.str(obj.stakes ?? '', '$.stakes', { allowEmpty: true }),
    rationale: c.str(obj.rationale ?? '', '$.rationale', { allowEmpty: true }),
    params: (obj.params ?? {}) as Json,
    onSuccess: maps.onSuccess,
    onPartial: maps.onPartial,
    onFailure: maps.onFailure,
  }

  const affordances: NodeAffordance[] = c.arr(obj.affordances ?? [], '$.affordances', 1, 5).flatMap((a, i) => {
    const af = c.obj(a, `$.affordances[${i}]`)
    const akey = c.str(af.key, `$.affordances[${i}].key`)
    const hint = c.str(af.hint, `$.affordances[${i}].hint`, { allowEmpty: true })
    return akey ? [{ key: canonicalizeAtomSlug(akey), label: affordanceLabel(kind, hint), hint }] : []
  })

  const transitions: NodeTransition[] = c.arr(obj.transitions ?? [], '$.transitions', 1, 6).flatMap((t, i) => {
    const tr = c.obj(t, `$.transitions[${i}]`)
    const on = c.oneOf(tr.on, `$.transitions[${i}].on`, TRANSITION_TIERS)
    const toNodeKey = tr.to_node_key == null ? null : c.str(tr.to_node_key, `$.transitions[${i}].to_node_key`)
    const arrivalContext = c.str(tr.arrival_context ?? '', `$.transitions[${i}].arrival_context`, { allowEmpty: true })
    // A partial/failed edge INTO a node must say how they got there - a setback narrated from the
    // destination's neutral seed reads as a success (the tier-blind-arrival bug).
    if (toNodeKey && on !== 'full' && !arrivalContext) {
      c.errors.push(`$.transitions[${i}].arrival_context: required on a ${on} edge into "${toNodeKey}"`)
    }
    return [{ on, toNodeKey, arrivalContext }]
  })

  if (c.errors.length > 0) return { ok: false, errors: c.errors }
  return {
    ok: true,
    // `NodeParseContext` carries no location vocabulary, so this parser cannot validate one and
    // does not guess. Stage 5b is where nodes get placed; anything parsed here reads as "wherever
    // the party is", which is the same safe default a rescue node uses.
    node: {
      key, objectiveKey: ctx.objectiveKey, index, kind, role, label, narrationSeed,
      locationKey: null, outcomeSummary: parseOutcomeSummary(obj.outcome),
      // Optional by contract: an unauthored pull falls back to the objective title at read time.
      pull: c.str(obj.pull ?? '', '$.pull', { allowEmpty: true }),
      // Stored rows authored before the decoupling carry their plot atom in `on_success`; this
      // parser has no objective predicate to derive from, so it reads none. Stage 5 is where
      // `establishes` is derived, and that is the only path new guides take.
      establishes: [],
      encounter, affordances, transitions, localAtoms,
    },
  }
}

/**
 * Chapter-local structural validation across an objective's nodes. Returns one message per
 * problem (stage 5 feeds these back into its generateParsed retry). The whole-adventure gate
 * (route counts, min_players, orphans) is graph.ts at stage 8.
 */
export function validateNodeGraph(nodes: readonly StoryNodeSpec[]): string[] {
  const errors: string[] = []
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  // Each objective's rescue node is materialized separately (buildRescueNode, from the stage-3
  // guaranteed route) and is not in `nodes` at parse time - but it is guaranteed to exist by the
  // time the graph is stored. The last route's failure edge is routed to it deliberately, so
  // treat a rescue key as known rather than reporting the one target that is always there.
  const isRescueKey = (key: string) => /#r\d+$/.test(key)

  for (const node of nodes) {
    for (const tr of node.transitions) {
      if (tr.toNodeKey === null) continue
      if (isRescueKey(tr.toNodeKey)) continue
      if (!byKey.has(tr.toNodeKey)) {
        errors.push(`node "${node.key}": transition on ${tr.on} points at unknown node "${tr.toNodeKey}"`)
        continue
      }
      // A failed edge that returns to its own source with no escalation is a stuck record: the
      // party retries the identical scene forever. Borrowed from the puzzle discipline (the
      // consequence always escalates). Escalation = the source node's onFailure writes >=1 atom.
      if (tr.on === 'failed' && tr.toNodeKey === node.key && node.encounter.onFailure.length === 0) {
        errors.push(
          `node "${node.key}": failed transition loops back to itself but onFailure writes no atom - ` +
            'a failure that changes nothing replays the same scene. Escalate (write a setback atom) ' +
            'or route the failure to a different node.',
        )
      }
    }
    // Every node must at least handle a full success.
    if (!node.transitions.some((t) => t.on === 'full')) {
      errors.push(`node "${node.key}": no transition on a full success`)
    }
  }
  return errors
}

/**
 * Social nodes whose staged cast no longer exists, and what they must become.
 *
 * Stage 5 authors nodes against the living roster, but stage 6 runs LATER and deletes NPC rows
 * that were really groups (`reclassifyGroupNpcs`). A social node staging one of those is orphaned:
 * it can never open, and the stage-8 gate rightly refuses the guide - which blocked generation
 * entirely, four retries deep (live 2026-07-26).
 *
 * The repair is the one the runtime already performs at open time: downgrade to a skill challenge
 * carrying the SAME outcome maps. The tier bridge makes that lossless for the spine.
 */
export function downgradeUnstageableNodes(
  nodes: readonly { key: string; kind: NodeKind; npcIds: readonly string[] }[],
  livingNpcIds: readonly string[],
): { key: string; from: NodeKind; to: NodeKind; reason: string }[] {
  const living = new Set(livingNpcIds)
  return nodes.flatMap((n) => {
    if (n.kind !== 'social') return []
    if (n.npcIds.some((id) => living.has(id))) return []
    return [{
      key: n.key,
      from: 'social' as NodeKind,
      to: 'skill_challenge' as NodeKind,
      reason: n.npcIds.length === 0 ? 'stages nobody' : 'everyone it stages was removed or is not present',
    }]
  })
}

/**
 * Dead/removed cast members to strike from a node that KEEPS its kind.
 *
 * `downgradeUnstageableNodes` only fires when a social node has nobody left, so a node staging
 * [alive, deleted] survives untouched - with the deleted id still in its spec. At open time
 * `resolveNpcNames` then throws "NPC <uuid> not found", the beat goes stillborn, and the director
 * burns a rung re-planning it. Live 2026-07-26: stage 6 reclassified a group NPC out of existence
 * after stage 5 had authored a node against it, and "Confront Sevren at the vault" went stillborn
 * three times. Surviving the downgrade is not the same as being clean.
 */
export function pruneNodeNpcIds(
  nodes: readonly { key: string; npcIds: readonly string[] }[],
  livingNpcIds: readonly string[],
): { key: string; npcIds: string[]; removed: string[] }[] {
  const living = new Set(livingNpcIds)
  return nodes.flatMap((n) => {
    const removed = n.npcIds.filter((id) => !living.has(id))
    if (removed.length === 0) return []
    return [{ key: n.key, npcIds: n.npcIds.filter((id) => living.has(id)), removed }]
  })
}

/** Atoms any node's outcome maps can award, canonicalized - fed into the graph.ts award set. */
export function nodeAwardAtoms(node: StoryNodeSpec): string[] {
  const out: string[] = []
  for (const a of [...node.encounter.onSuccess, ...node.encounter.onPartial, ...node.encounter.onFailure]) {
    const slug = canonicalizeAtomSlug(a)
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/** True when the outcome maps reference an atom outside the allowed menu - a resolved node
 *  should never, but a hand-edited row might. Used by the graph gate. */
export function nodeOutcomesOffMenu(node: StoryNodeSpec, menu: readonly string[]): string[] {
  const all = [...node.encounter.onSuccess, ...node.encounter.onPartial, ...node.encounter.onFailure]
  return all.filter((a) => !resolveAtomText(a, menu).ok)
}
