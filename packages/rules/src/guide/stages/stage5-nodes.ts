// Stage 5b - Story Architect: author the playable NODE GRAPH per chapter (story-engine
// overhaul, 2026-07-26). This is the beat planner + encounter designer moved OUT of runtime.
//
// Division of labour (the standing rule): CODE owns identity and completion - a route node's
// on_success is DERIVED from the objective's predicate (minimalSatisfyingAtoms), exactly as the
// stage-5 encounters already derive outcome_atoms, so every authored route provably completes
// its objective and the reachability lint can prove it finishable. The LLM writes only the
// fiction it is good at: which shape the encounter takes, its cutscene seed, its chips, the
// setbacks a failure costs, and how the party moves between nodes.

import { Check } from '../json.ts'
import { listMilestoneAtoms } from '../../story/evaluate.ts'
import { minimalSatisfyingAtoms } from '../guaranteed-route.ts'
import type { GuaranteedRoute } from '../guaranteed-route.ts'
import { ENCOUNTER_KINDS } from '../../story/beats.ts'
import type { BeatEncounterKind } from '../../story/beats.ts'
import { affordanceLabel, nodeKeyFor, validateNodeGraph } from '../nodes.ts'
import type { NodeAffordance, NodeTransition, StoryNodeSpec, TransitionTier } from '../nodes.ts'
import { TRANSITION_TIERS } from '../nodes.ts'
import { canonicalizeAtomSlug, MAX_LOCAL_ATOMS_PER_BEAT, resolveAtomText } from '../../story/atoms.ts'
import type { AtomKind, AtomProposal } from '../../story/atoms.ts'
import type { Json, ParseResult } from '../types.ts'

export const MIN_ROUTE_NODES = 2

export interface Stage5NodesObjective {
  id: string
  title: string
  hiddenDescription: string
  completionPredicates: unknown
}

export interface Stage5NodesContext {
  chapterNumber: number
  chapterTitle: string
  objectives: Stage5NodesObjective[]
  /** Living, present NPCs the chapter can stage (social nodes pick from these). */
  npcs: { key: string; name: string }[]
  partySkills: string[]
}

/** A parsed node plus the raw npc keys the orchestrator resolves to ids against the DB. */
export interface AuthoredNode {
  node: StoryNodeSpec
  npcKeys: string[]
}

export interface Stage5NodesOutput {
  nodes: AuthoredNode[]
  /** All local atoms declared across the chapter, for one registry pass. */
  localAtoms: AtomProposal[]
}

export const objectiveKeyOf = (id: string): string => `obj:${id}`

const LABEL_MAX = 60

/** Trim to a word boundary, falling back to the objective title when there is nothing to use. */
function nodeLabel(hint: string, fallback: string): string {
  const text = hint.trim()
  if (!text) return fallback
  if (text.length <= LABEL_MAX) return text
  const cut = text.slice(0, LABEL_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`
}

/**
 * Materializes the objective's code-authored guaranteed_route as a rescue node - so the
 * director's rung-4 rescue is also just navigation. onSuccess is already the objective's minimal
 * satisfying set (built at stage 3), so a rescue win provably completes it.
 */
export function buildRescueNode(objectiveId: string, route: GuaranteedRoute): StoryNodeSpec {
  const objKey = objectiveKeyOf(objectiveId)
  return {
    key: nodeKeyFor(objKey, 'rescue', 0),
    objectiveKey: objKey,
    index: 0,
    kind: 'skill_challenge',
    role: 'rescue',
    label: route.label,
    // The seed is what the NARRATOR opens the scene on, so it must read as fiction. `guidance` is
    // designer instruction ("Shape: a pursuit where ground is lost on every failure...") and
    // shipping it here put mechanical template text straight into the player-facing prompt
    // (caught in the first authored-graph guide, 2026-07-26). It rides in params instead, which
    // is where the director's rung-4 delivery already reads it from.
    narrationSeed: route.stakes
      ? `The way forward narrows to one thing: ${route.label}. ${route.stakes}`
      : `The way forward narrows to one thing: ${route.label}.`,
    encounter: {
      kind: 'skill_challenge',
      label: route.label,
      stakes: route.stakes,
      rationale: 'guaranteed route (rescue)',
      params: { ...((route.params ?? {}) as Record<string, unknown>), guidance: route.guidance } as Json,
      onSuccess: route.onSuccess,
      onPartial: route.onPartial,
      onFailure: route.onFailure,
    },
    affordances: [{ key: 'attempt', label: affordanceLabel('skill_challenge', route.label), hint: route.label }],
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    localAtoms: [],
  }
}

function objectiveAtomNames(predicate: unknown): string[] {
  const atoms = listMilestoneAtoms(predicate)
  return [...atoms.flags, ...atoms.events, ...atoms.facts]
}

export function buildStage5NodesPrompt(ctx: Stage5NodesContext): { system: string; user: string; maxTokens: number } {
  const system = `You are the Story Architect for a tabletop RPG platform. For one chapter, author the playable NODE GRAPH: the concrete scenes the party moves through to achieve each objective.

Rules:
- For EACH objective, author at least ${MIN_ROUTE_NODES} DISTINCT route nodes - genuinely different ways to achieve it (a stealth route AND a social route; a clever route AND a forceful route). This is the Three-Clue Rule: a party that flubs one way still has another.
- Each node has ONE kind: "skill_challenge", "social", "puzzle", or "combat". Vary them - do not make every route a skill_challenge. At least one combat somewhere in the adventure.
- A "social" node MUST name at least one living NPC by key from the list.
- You do NOT author what a success awards - the engine derives that from the objective. You author what a SETBACK costs: declare up to ${MAX_LOCAL_ATOMS_PER_BEAT} local atoms (flags/events) per node and reference them in on_failure. A failure must change something.
- narration_seed: 1-2 sentences the narrator opens the scene on, ending on a hook. stakes: one line - what is at risk.
- affordances: 2-3 short player options {key, hint}. The hint is the flavor; the app prefixes the mechanic.
- transitions: an outcome is PASS or FAIL, never anything in between. Every node needs a "full" transition, and a full success ALWAYS resolves the objective - so its "to" is always "done". A "failed" outcome NEVER resolves the objective: its "to" must be the index of a DIFFERENT node in THIS objective (never "done", never its own index) - a setback sends the party somewhere else to try again. Every failed edge MUST carry an "arrival_context": one line describing how the party arrives THERE having just fallen short - never phrased as a success.

Respond with ONLY a JSON object:
{
  "objectives": [
    { "objective_number": 1, "nodes": [
      { "kind": "social", "narration_seed": "...", "stakes": "...",
        "npc_keys": ["npc:..."],
        "affordances": [ { "key": "press", "hint": "press her on the ledger" } ],
        "local_atoms": [ { "name": "warden_suspicious", "kind": "flag" } ],
        "on_failure": ["warden_suspicious"],
        "transitions": [ { "on": "full", "to": "done", "arrival_context": "" },
                         { "on": "failed", "to": 1, "arrival_context": "Shut out, the party must try the cellar instead." } ] }
    ] }
  ]
}`

  const objectiveList = ctx.objectives
    .map((o, i) => `${i + 1}. ${o.title} - ${o.hiddenDescription}`)
    .join('\n')
  const npcList = ctx.npcs.map((n) => `${n.key} (${n.name})`).join(', ') || 'none'
  const user = `Chapter ${ctx.chapterNumber}: ${ctx.chapterTitle}

Objectives:
${objectiveList}

Living NPCs available to stage: ${npcList}
Party skills: ${ctx.partySkills.join(', ') || 'unknown'}`

  return { system, user, maxTokens: 4000 }
}

export function parseStage5Nodes(raw: string, ctx: Stage5NodesContext): ParseResult<Stage5NodesOutput> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return { ok: false, errors: ['response contains no JSON object'] }
  let root: Record<string, unknown>
  try {
    root = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch (err) {
    return { ok: false, errors: [`response JSON does not parse: ${err instanceof Error ? err.message : String(err)}`] }
  }

  const c = new Check()
  const npcKeySet = new Set(ctx.npcs.map((n) => n.key))
  const nodes: AuthoredNode[] = []
  const localAtoms: AtomProposal[] = []

  const objectiveBlocks = c.arr(root.objectives, '$.objectives', 1, ctx.objectives.length)
  const seenObjectives = new Set<number>()

  for (let bi = 0; bi < objectiveBlocks.length; bi++) {
    const block = c.obj(objectiveBlocks[bi], `$.objectives[${bi}]`)
    const objectiveIndex = c.int(block.objective_number, `$.objectives[${bi}].objective_number`, 1, ctx.objectives.length) - 1
    const objective = ctx.objectives[objectiveIndex]
    if (!objective) continue
    seenObjectives.add(objectiveIndex)
    const objKey = objectiveKeyOf(objective.id)
    const onSuccess = (minimalSatisfyingAtoms(objective.completionPredicates) ?? []) as string[]
    if (onSuccess.length === 0) {
      c.errors.push(`$.objectives[${bi}]: objective "${objective.title}" has no writable completion atom`)
      continue
    }
    const menu = objectiveAtomNames(objective.completionPredicates)

    const rawNodes = c.arr(block.nodes, `$.objectives[${bi}].nodes`, MIN_ROUTE_NODES, 5)
    const nodeCount = rawNodes.length

    rawNodes.forEach((rawNode, ni) => {
      const path = `$.objectives[${bi}].nodes[${ni}]`
      const n = c.obj(rawNode, path)
      // CONTENT slips are repaired, never fatal. Stage 5 is a hard pipeline stage: a single bad
      // atom kind ("fact" instead of "flag") or one missing seed used to fail the WHOLE chapter,
      // four retries deep, and no guide could be generated at all (live 2026-07-26). This is the
      // same lesson the boss-tactics drop above records - and the same one stage 7 just learned.
      // Structural minimums (>=2 route nodes, every objective covered) stay hard below.
      const kind = (ENCOUNTER_KINDS.find((k) => k === n.kind) ?? 'skill_challenge') as BeatEncounterKind
      const stakes = c.str(n.stakes ?? '', `${path}.stakes`, { allowEmpty: true })

      // Declared setback atoms - the menu for on_failure = objective atoms + these.
      const declared: AtomProposal[] = c.arr(n.local_atoms ?? [], `${path}.local_atoms`, 0, MAX_LOCAL_ATOMS_PER_BEAT)
        .flatMap((a, ai) => {
          const at = c.obj(a, `${path}.local_atoms[${ai}]`)
          const name = typeof at.name === 'string' ? at.name.trim() : ''
          // Anything that is not an event is stored as a flag: both are claimable booleans, and
          // the alternative was discarding a whole chapter over one mislabelled setback.
          const akind: AtomKind = at.kind === 'event' ? 'event' : 'flag'
          return name ? [{ name, kind: akind }] : []
        })
      localAtoms.push(...declared)
      const outcomeMenu = [...menu, ...declared.map((a) => a.name)]
      const resolveAtoms = (key: 'on_failure'): string[] => {
        const list = Array.isArray(n[key]) ? (n[key] as unknown[]) : []
        const out: string[] = []
        for (const entry of list) {
          if (typeof entry !== 'string' || !entry.trim()) continue
          const res = resolveAtomText(entry, outcomeMenu)
          if (res.ok && !out.includes(res.text)) out.push(res.text)
        }
        return out
      }

      // A SETBACK MUST COST SOMETHING. The prompt asks for it and the model routinely skips it -
      // live 2026-07-26, three of five encounter resolutions came in failed or partial and every
      // one awarded zero atoms, so the world recorded nothing about a party that kept losing.
      // The model already declared its setback atoms; if it forgot to reference one, code does.
      const onFailure = resolveAtoms('on_failure')
      let repairedFailure = onFailure
      if (repairedFailure.length === 0) {
        if (declared.length > 0) {
          repairedFailure = [declared[0].name]
        } else {
          // The model declared nothing to spend. Synthesize one readable, deterministic setback
          // and register it, rather than letting the node ship with a free loss - which the
          // stage-8 `failure_writes_nothing` gate would (correctly) refuse, taking the whole
          // guide down over an omission code can fill in perfectly.
          const synthetic = canonicalizeAtomSlug(`${objective.title} attempt ${ni + 1} failed`)
          if (synthetic) {
            const atom: AtomProposal = { name: synthetic, kind: 'flag' }
            localAtoms.push(atom)
            repairedFailure = [synthetic]
          }
        }
      }

      const npcKeys = (Array.isArray(n.npc_keys) ? n.npc_keys : [])
        .filter((k): k is string => typeof k === 'string' && npcKeySet.has(k))
      // A social node nobody can staff is downgraded to a skill challenge carrying the SAME
      // outcome maps - the tier bridge makes that lossless for the spine, and it is exactly what
      // the runtime already does at open time (story/staging.ts). Authoring it away here means the
      // stillborn node never reaches the database in the first place.
      const resolvedKind: BeatEncounterKind = kind === 'social' && npcKeys.length === 0 ? 'skill_challenge' : kind

      // Chips: bad entries drop, and a node left with none gets one generic way in rather than
      // taking the chapter down with it.
      const parsedAffordances: NodeAffordance[] = (Array.isArray(n.affordances) ? n.affordances : [])
        .slice(0, 3)
        .flatMap((a) => {
          if (typeof a !== 'object' || a === null) return []
          const af = a as Record<string, unknown>
          const akey = canonicalizeAtomSlug(typeof af.key === 'string' ? af.key : '')
          const hint = typeof af.hint === 'string' ? af.hint.trim() : ''
          return akey ? [{ key: akey, label: affordanceLabel(resolvedKind, hint), hint }] : []
        })
      const affordances: NodeAffordance[] = parsedAffordances.length > 0
        ? parsedAffordances
        : [{ key: 'engage', label: affordanceLabel(resolvedKind, objective.title), hint: objective.title }]

      const transitions: NodeTransition[] = c.arr(n.transitions, `${path}.transitions`, 1, 6).flatMap((t, ti) => {
        const tr = c.obj(t, `${path}.transitions[${ti}]`)
        const on = (TRANSITION_TIERS.find((x) => x === tr.on) ?? 'full') as TransitionTier
        let toNodeKey: string | null = null
        // A full success on a ROUTE node always completes the objective - its on_success IS the
        // objective's minimal satisfying set (derived above, property-tested in guaranteed-route).
        // So a `full -> sibling` edge is dead by construction: the objective resolves, progress
        // evaluation moves the ladder on, and the sibling never plays. Authored ones were shipping
        // (2026-07-26); code decides this rather than hoping the prompt is obeyed.
        if (on === 'full') return [{ on, toNodeKey: null, arrivalContext: '' } as NodeTransition]
        if (tr.to !== 'done' && tr.to != null) {
          const idx = typeof tr.to === 'number' ? tr.to : Number(tr.to)
          // Out of range, or pointing at itself (a self-loop the party just replays): fall to the
          // deterministic ladder below rather than failing the chapter over one bad index.
          if (Number.isInteger(idx) && idx >= 0 && idx < nodeCount && idx !== ni) {
            toNodeKey = nodeKeyFor(objKey, 'route', idx)
          }
        }
        // A SETBACK MAY NEVER RESOLVE THE OBJECTIVE. `to: "done"` on a failed/partial edge produced
        // a node that opened nothing next and credited nothing, leaving the objective open with the
        // party in a finished scene - and the model reached for it constantly, because the prompt
        // used to permit it: 68 such edges across 11 of 11 guides authored before 2026-07-27.
        //
        // So code decides where a setback goes, the same way it already decides that a full success
        // resolves the objective. The ladder preserves the Three-Clue shape - fail route 0 and you
        // get route 1, fail the last route and the rescue is what is left - instead of handing over
        // the guaranteed route on the party's first stumble.
        if (!toNodeKey) {
          toNodeKey = ni + 1 < nodeCount
            ? nodeKeyFor(objKey, 'route', ni + 1)
            : nodeKeyFor(objKey, 'rescue', 0)
        }
        let arrivalContext = typeof tr.arrival_context === 'string' ? tr.arrival_context.trim() : ''
        // A setback edge MUST say how the party arrives, or the destination's neutral seed narrates
        // a failure as a success. If the author left it blank, code writes the honest minimum
        // rather than dropping the edge (which would strand the failure tier).
        if (toNodeKey && !arrivalContext) {
          arrivalContext = on === 'failed'
            ? 'That attempt fails, and the party is forced to look for another way.'
            : 'That gets them only part of the way, and they must press on from a worse position.'
        }
        return [{ on, toNodeKey, arrivalContext }]
      })
      // Every node needs a full-success exit, and there is exactly one right answer for a route
      // node (the objective resolves). Supplying it beats rejecting the chapter for an omission
      // code can fill in perfectly.
      if (!transitions.some((t) => t.on === 'full')) {
        transitions.unshift({ on: 'full', toNodeKey: null, arrivalContext: '' })
      }

      // A missing seed is thin, not fatal: stage 7 reads node prose and can rewrite it, and the
      // narrator still has the objective and stakes to open on. Failing here cost a whole guide.
      const authoredSeed = typeof n.narration_seed === 'string' ? n.narration_seed.trim() : ''
      const narrationSeed = authoredSeed ||
        `The party faces this directly: ${objective.title}.${stakes ? ` ${stakes}` : ''}`

      const node: StoryNodeSpec = {
        key: nodeKeyFor(objKey, 'route', ni),
        objectiveKey: objKey,
        index: ni,
        kind: resolvedKind,
        role: 'route',
        // A human-readable name for the scene (the beat name, and the lab's node list). Derived
        // from the first chip's flavour, trimmed at a WORD boundary - a raw slice(0,60) shipped
        // labels cut mid-word ("...sealing his solitary sacri", 2026-07-26).
        label: nodeLabel(affordances[0]?.hint ?? '', objective.title),
        narrationSeed,
        encounter: {
          kind: resolvedKind, label: objective.title, stakes, rationale: '',
          params: {} as Json,
          onSuccess, // DERIVED - code owns completion.
          // Pass or fail (2026-07-27): nothing authors or reads a partial map any more. The field
          // stays on the type so stored rows still parse; it is always empty going forward.
          onPartial: [],
          onFailure: repairedFailure,
        },
        affordances,
        transitions,
        localAtoms: declared,
      }
      nodes.push({ node, npcKeys })
    })
  }

  // Every objective needs its route nodes authored.
  for (let i = 0; i < ctx.objectives.length; i++) {
    if (!seenObjectives.has(i)) {
      c.errors.push(`$.objectives: no nodes authored for objective ${i + 1} ("${ctx.objectives[i].title}")`)
    }
  }

  // Chapter-local structural pass (dangling / failure-loop / missing full transition) - feeds the
  // generateParsed retry so the author fixes it before anything is stored.
  for (const problem of validateNodeGraph(nodes.map((a) => a.node))) c.errors.push(problem)

  return c.result({ nodes, localAtoms })
}
