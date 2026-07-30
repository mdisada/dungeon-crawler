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
import { minimalSatisfyingAtoms } from '../guaranteed-route.ts'
import type { GuaranteedRoute } from '../guaranteed-route.ts'
import { ENCOUNTER_KINDS } from '../../story/beats.ts'
import type { BeatEncounterKind } from '../../story/beats.ts'
import { affordanceLabel, nodeKeyFor, parseOutcomeSummary, validateNodeGraph } from '../nodes.ts'
import type { NodeAffordance, NodeTransition, StoryNodeSpec } from '../nodes.ts'
import { canonicalizeAtomSlug, MAX_LOCAL_ATOMS_PER_BEAT } from '../../story/atoms.ts'
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
  /**
   * Living, present NPCs the chapter can stage - WHO THEY ARE, not just what they are called.
   *
   * This was `{key, name}`, and the thinness was the bug. Stage 4 authors `role` and
   * `description` on every NPC row and both were dropped before the node author saw them, so a
   * chapter whose scenes read "harbourmaster Teresa Vane" reached stage 5b as the bare string
   * "Teresa Vane". Needing a harbourmaster and seeing none, it invented one - "a stout man named
   * Silas" - who appears in two nodes with a described build and manner, stages nobody (his
   * npc_ids are correctly empty), can never speak, and holds no disposition.
   *
   * Six such phantom people across four of eight measured guides, and every one entered here.
   * Not one entered at stage 1, 2, 3 or 4, where the hand-offs are governed. The fix needed no
   * new authored field and no new schema: stop discarding what stage 4 already wrote.
   */
  npcs: { key: string; name: string; role?: string; description?: string }[]
  /** Places this chapter can stage a node at. Closed vocabulary - a node may pick no other. */
  locations: { key: string; name: string }[]
  /**
   * Titles of the chapter's OTHER objectives, authored in their own calls (2026-07-29).
   *
   * Stage 5 is called once per objective rather than once per chapter, because one call for a
   * whole chapter's node graph ran to 4000 output tokens - exactly the cap, so the reply was
   * truncated - and 83s, which blew the edge function's ~150s wall clock and failed the guide.
   * Splitting keeps each call small; this field is what stops the objectives drifting into each
   * other's ground now that no single call sees them all.
   */
  otherObjectiveTitles?: string[]
  /**
   * Stage 2's scene sketches - the concrete beats this chapter was PLANNED around.
   *
   * They were being loaded and handed to stages 3 and 4 and then dropped here, so the chapter got
   * decomposed twice by two models that never compared notes: stage 2 planned the scenes, stage 5b
   * independently invented the playable ones. Guide 350c0363's chapter plan turned on "Mira Coth
   * provides the first hard clue - her brother's ship appears in the ledger but never docked", and
   * no authored node mentioned a brother. The hook was planned and then not built.
   *
   * Grounding, not a contract: the objectives are what the nodes must serve, and a chapter with no
   * scenes on file authors exactly as it did before.
   */
  scenes: string[]
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
 * director's rung-4 rescue is also just navigation.
 *
 * `route.onSuccess` is the objective's minimal satisfying set (built at stage 3). Since 2026-07-29
 * that set is the node's `establishes` - credited when the rescue RESOLVES, at any tier - rather
 * than its win prize. A rescue is the floor a spent party is dropped onto; making the plot fact
 * conditional on winning it is what let objective 0 of run 9a5f87a6 lose its canon on a 0-2 roll.
 */
/** One authored way a conversation can end. Mirrors what socialExits reads at runtime. */
export interface SocialExitSpec {
  outcome: string
  description: string
  tier: 'success' | 'partial' | 'failure'
}

/**
 * Authored conversation endings, repaired rather than rejected.
 *
 * Keeps at most 4 well-formed entries and GUARANTEES at least one non-failure tier: a social node
 * whose only exits are failures is one the party cannot talk their way out of, which is the exact
 * shape that made all 57 social nodes across 23 guides unwinnable. Absent or unusable input yields
 * a deterministic default pair rather than taking the chapter down.
 */
export function parseSocialExits(raw: unknown, objectiveTitle: string): SocialExitSpec[] {
  const parsed = (Array.isArray(raw) ? raw : []).flatMap((e): SocialExitSpec[] => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return []
    const o = e as Record<string, unknown>
    const outcome = canonicalizeAtomSlug(typeof o.outcome === 'string' ? o.outcome : '')
    if (!outcome) return []
    const tier = o.tier === 'partial' || o.tier === 'failure' ? o.tier : 'success'
    return [{
      outcome,
      description: typeof o.description === 'string' ? o.description.trim() : '',
      tier: tier as SocialExitSpec['tier'],
    }]
  }).slice(0, 4)

  const winnable = parsed.some((e) => e.tier !== 'failure')
  if (parsed.length > 0 && winnable) return parsed

  // Deterministic floor. Named from the objective so the judge has something concrete to match the
  // conversation against, and always paired so there is a real decision to make.
  const goal = objectiveTitle.trim() || 'what they came for'
  const fallback: SocialExitSpec[] = [
    {
      outcome: canonicalizeAtomSlug(`${goal} given up`) || 'they_give_it_up',
      description: `They give the party ${goal.toLowerCase()}.`,
      tier: 'success',
    },
    {
      outcome: canonicalizeAtomSlug(`${goal} withheld`) || 'they_close_ranks',
      description: 'They close ranks and the party leaves with nothing from this conversation.',
      tier: 'failure',
    },
  ]
  // An authored failure exit is still the author's, so keep it beside the synthesized way out.
  return [...fallback, ...parsed.filter((e) => e.tier === 'failure')].slice(0, 4)
}

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
    // Reads as FICTION and carries no authoring metadata (2026-07-28). It used to append
    // `route.stakes`, which was the objective's DM-only hidden_description - so the scene a
    // FAILING party is handed as its floor opened on "Scene 5 forces a choice..." and a
    // sentence cut off mid-word. The narrator grounds the rest in the live scene, which is
    // what it does for every authored node whose seed is one line.
    // Makes NO claim about the other routes (2026-07-28). The first wording said "every other way
    // has closed behind the party", which is true at RUNTIME - the navigator only reaches a rescue
    // once the routes are spent - but false on the page the consistency checker reads, where this
    // is simply one of three authored ways in. It flagged it on all four objectives of the next
    // guide, and it was right to. The seed describes the scene; the ladder position is the
    // navigator's business, not the narrator's.
    narrationSeed:
      `The party comes at ${route.label} the hard way, with whatever they still have on them.`,
    encounter: {
      kind: 'skill_challenge',
      label: route.label,
      stakes: route.stakes,
      rationale: 'guaranteed route (rescue)',
      params: { ...((route.params ?? {}) as Record<string, unknown>), guidance: route.guidance } as Json,
      // Flavour only now - the plot fact moved to `establishes` below.
      onSuccess: [],
      onPartial: route.onPartial,
      onFailure: route.onFailure,
    },
    establishes: route.onSuccess,
    affordances: [{ key: 'attempt', label: affordanceLabel('skill_challenge', route.label), hint: route.label }],
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    // Deliberately unplaced. A rescue node is the floor the director drops a spent party onto, and
    // it has to be reachable from wherever they already stand - pinning it to one location would
    // make the last resort require a journey. The runtime treats a null location as "here".
    locationKey: null,
    // A rescue is the floor: it is reached having lost every authored route, and it has no failure
    // edge of its own, so only the win is a state anything downstream will ever read.
    outcomeSummary: { win: `The party achieves this the hard way: ${route.label}.`, loss: '' },
    // A rescue node is materialized by code from the stage-3 guaranteed route, so there is nobody
    // to author a pull. Empty falls back to the objective title, which is what this path has always
    // shown the narrator.
    pull: '',
    localAtoms: [],
  }
}

export function buildStage5NodesPrompt(ctx: Stage5NodesContext): { system: string; user: string; maxTokens: number } {
  const system = `You are the Story Architect for a tabletop RPG platform. For one chapter, author the playable NODE GRAPH: the concrete scenes the party moves through to achieve each objective.

Rules:
- For EACH objective, author at least ${MIN_ROUTE_NODES} DISTINCT route nodes - genuinely different ways to achieve it (a stealth route AND a social route; a clever route AND a forceful route). This is the Three-Clue Rule: a party that flubs one way still has another.
- Those routes are INTERCHANGEABLE. Whichever one the party wins, they come away knowing and holding the SAME things - this objective's conclusion. Everything authored after this point is written against that shared conclusion and CANNOT TELL which route was taken, so a route that teaches something the others do not leaves every later scene guessing. If only one of your routes reveals who was really responsible, that is a bug: either they all reveal it, or none of them does and it belongs to a later objective.
- SAME CONCLUSION, DIFFERENT COST. What legitimately differs between routes is the method, who helps and who is crossed, what is spent, and what it costs the party to get there. The "setback" is where a route's identity lives - keep it specific to THAT route and never make two routes cost the same thing.
- THE ROUTES ARE A LADDER, NOT A MENU. At the table the party plays route 1 first. They only ever reach route 2 by FAILING route 1, arriving on its setback_line; route 3 only after failing both. So write route 2's narration_seed so it is still true AFTER route 1 has been lost, and route 3's after route 1 and 2 have been. Never open a later route as though the objective were untouched, and never have it announce as still-to-come something an earlier setback already said had happened.
- ROUTE 1 OPENS A SITUATION. EVERY LATER ROUTE OPENS AN ATTEMPT. Route 1 may say something arrives, begins, or is discovered. Routes 2 and 3 may not: by then it has already arrived, already begun, and the party has already had a go at it and lost. Open those on the PARTY and what they do next - "with the front door shut, the cellar grate is the only way left" - never on the scene assembling itself again. Concretely: no later route may re-introduce a character who was present in an earlier one, restate that something "has arrived" or "begins", or describe the party approaching a place they are already standing in.
- Give every node an "outcome": one present-tense sentence for "win" and one for "loss", each stating what is TRUE afterwards. This is the record every later scene reads instead of guessing, so write the STATE, not the drama ("The party holds proof the ledger entries are forged", not "A stunning revelation!").
- A LOSS NEVER REMOVES A PERSON. It may cost the party time, trust, standing, evidence, safety or surprise - but in a setback no named character dies, leaves for good, or finishes what they were trying to do. The next route needs that cast alive and that goal still open, or the scene it hands the party is a lie.
- A LOSS NEVER ENDS THE STORY. Losing one scene is not losing the objective: the party still has another way in, and after that a last resort. So a "loss" must never say the villain won, the ritual completed, the town fell, or the thing the objective exists to prevent happened. Write what this ATTEMPT cost them, nothing wider.
- EVERY LOSS IS DIFFERENT. Two routes may not cost the same thing - the loss is where a route's identity lives. Never reuse a loss sentence between routes of the same objective.
- Each node has ONE kind: "skill_challenge", "social", "puzzle", or "combat". Vary them - do not make every route a skill_challenge. At least one combat somewhere in the adventure.
- A "social" node MUST name at least one living NPC by key from the list.
- A "social" node MUST also author "exits": 2-4 ways the conversation can END, each { "outcome": short_snake_case_name, "description": one line, "tier": "success" | "partial" | "failure" }. At least one must be "success" or "partial", or the scene is one nobody can talk their way out of. These are FLAVOUR, not progression - the story advances either way - so make them read as genuinely different endings to the same conversation ("she_names_the_buyer" / "she_talks_but_wants_paying" / "she_closes_ranks"), never as degrees of the same one.
- CAST ONLY FROM THE ROSTER. The people below are everyone this chapter has. If a scene needs a harbourmaster, a warden, a fence, look for who already holds that role and use them - do NOT write a new named person into narration_seed, label, setback_line or outcome. A name you invent has no row behind it: nobody can talk to them, they hold no disposition, they cannot be staged, and they vanish when the scene ends. Unnamed background figures (a clerk, two dockhands, the crowd) are fine.
- You do NOT author outcomes, edges, or what a success awards. The engine derives every one of those. You write the FICTION and pick from the menus.
- narration_seed: 1-2 sentences the narrator opens the scene on, ending on a hook. stakes: one line - what is at risk.
- pull: ONE present-tense sentence naming the unresolved thing in the world while this scene is live - what the narrator writes from on every turn it is open. This is NOT the objective restated: write the SITUATION, never the task. "The tower stair is gated and Mother Solla keeps the key" - never "Learn why the bell tolls". It must read as prose about the room, because the narrator sees it every turn and will sometimes echo it, and an echoed situation costs nothing while an echoed task breaks the fiction. Name only what the party can already see or has already been told: this is orientation, not a reveal, so it may never mention a place they have not reached or a fact they have not learned.
- affordances: 2-3 ways into this scene, {key, hint}. THE HINT IS SHOWN TO THE PLAYER VERBATIM, as a chip beside their input box - nothing is added to it, so write the words you want them to read. A short imperative in the player's own voice, 3-8 words, written as a sentence starting with a capital: "Press her on the ledger", "Force the cellar grate", "Offer to pay her debt". NOT "Attempt to press her on the ledger" - no "attempt to", "try to" or "you could", because the chip IS the attempt. NOT the scene's name restated. Each one a genuinely different way in, not three shades of the same approach.
- setback: the ONE thing that changes when the party falls short here - a short flag name and a kind. Name the consequence, not the failure ("warden_suspicious", not "check_failed"). It must be specific to THIS scene, never the objective's own goal.
- setback_line: one line describing how the party arrives at their next attempt having just fallen short here. Never phrase it as a success.

- Give every node a "location_key" naming WHERE it happens, chosen from the places listed below and nothing else. Two nodes may share a place. Pick the place the scene physically occupies, not one it merely concerns: a node about reading a stolen ledger happens wherever the party reads it. This is what lets the game tell a party standing somewhere else that they still have to travel, so an invented place is worse than none.

Respond with ONLY a JSON object:
{
  "objectives": [
    { "objective_number": 1, "nodes": [
      { "kind": "social", "narration_seed": "...", "stakes": "...",
        "pull": "The warden's ledger sits behind her counter and she has not let anyone near it.",
        "npc_keys": ["npc:..."], "location_key": "loc:...",
        "exits": [ { "outcome": "she_names_the_buyer", "description": "Maren gives up the name.", "tier": "success" },
                   { "outcome": "she_closes_ranks", "description": "She shuts the door on them.", "tier": "failure" } ],
        "outcome": { "win": "The party holds the warden's own account of the forged entries.",
                     "loss": "The warden has shut the party out and word of their interest is spreading." },
        "affordances": [ { "key": "press", "hint": "Press her on the ledger" } ],
        "setback": { "name": "warden_suspicious", "kind": "flag" },
        "setback_line": "Shut out, the party must try the cellar instead." }
    ] }
  ]
}`

  const objectiveList = ctx.objectives
    .map((o, i) => `${i + 1}. ${o.title} - ${o.hiddenDescription}`)
    .join('\n')
  // One line per person rather than a comma list: a roster the author can actually cast from.
  const oneLine = (s: string | undefined) => {
    const t = String(s ?? '').trim().split(/(?<=[.!?])\s/)[0] ?? ''
    return t.length > 160 ? `${t.slice(0, 157)}...` : t
  }
  const npcList = ctx.npcs.length === 0
    ? 'none'
    : `\n${ctx.npcs.map((n) => {
      const who = [n.role && n.role !== 'npc' ? n.role : '', oneLine(n.description)].filter(Boolean).join(' - ')
      return `  ${n.key} (${n.name})${who ? ` - ${who}` : ''}`
    }).join('\n')}`
  const locationList = ctx.locations.map((l) => `${l.key} (${l.name})`).join(', ') || 'none'
  // The plan comes BEFORE the objectives deliberately: it is the texture the chapter was built
  // from, and a node that reuses its specifics ("her brother's ship") reads as part of the story
  // rather than beside it.
  const sceneBlock = ctx.scenes.length > 0
    ? `Scenes this chapter was planned around - hidden scaffolding, never shown to players. Build your nodes OUT of these: reuse their people, objects and specifics rather than inventing parallel material for the same objectives.
${ctx.scenes.map((s, i) => `${i + 1}. ${s}`).join('\n')}

`
    : ''
  // Named, never authored here. Stage 5 runs once per objective now, so without this the call has
  // no idea the chapter has other threads and quietly reuses their scenes and their ground.
  const siblingBlock = (ctx.otherObjectiveTitles ?? []).length > 0
    ? `
Other objectives in this chapter, authored SEPARATELY - do not write nodes for them, and do not spend their material on yours: ${(ctx.otherObjectiveTitles ?? []).join(' | ')}
`
    : ''
  const user = `Chapter ${ctx.chapterNumber}: ${ctx.chapterTitle}

${sceneBlock}Objectives:
${objectiveList}
${siblingBlock}
Living NPCs available to stage: ${npcList}
Places available to stage a node at: ${locationList}
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
  const locationKeySet = new Set(ctx.locations.map((l) => l.key))
  const nodes: AuthoredNode[] = []
  const localAtoms: AtomProposal[] = []
  const authoredLosses: { key: string; objKey: string; loss: string }[] = []

  const objectiveBlocks = c.arr(root.objectives, '$.objectives', 1, ctx.objectives.length)
  const seenObjectives = new Set<number>()

  for (let bi = 0; bi < objectiveBlocks.length; bi++) {
    const block = c.obj(objectiveBlocks[bi], `$.objectives[${bi}]`)
    const objectiveIndex = c.int(block.objective_number, `$.objectives[${bi}].objective_number`, 1, ctx.objectives.length) - 1
    const objective = ctx.objectives[objectiveIndex]
    if (!objective) continue
    seenObjectives.add(objectiveIndex)
    const objKey = objectiveKeyOf(objective.id)
    // THE PLOT FACT, CREDITED ON RESOLUTION (2026-07-29). This is the objective's minimal
    // satisfying set and it is still DERIVED, not authored - only where it pays out has changed.
    //
    // It used to be the node's `onSuccess`, i.e. the prize for WINNING. Measured across 103 nodes
    // in 12 guides, 103 of 103 gated a plot atom behind a win and 103 of 103 credited no plot atom
    // on a loss - so the encounter WAS the plot, which inverts the invariant. Live in 9a5f87a6 the
    // party lost all three routes of objective 0 and its fact was never written while every
    // setback fired: the price recorded, the fact not.
    //
    // Now it rides on `establishes` and the runtime credits it at ANY tier. An empty set still
    // costs nothing - see the 2026-07-27 note this replaces.
    const establishes = (minimalSatisfyingAtoms(objective.completionPredicates) ?? []) as string[]
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

      // ONE setback per node. The model used to declare up to four local atoms and separately
      // choose which of them `on_failure` spent - two fields, and every way of getting the pairing
      // wrong was a node whose failure cost nothing (or, worse, awarded the objective itself).
      // With `partial` gone a node needs exactly one consequence, so asking for exactly one makes
      // "a failure must change something" true by construction rather than by repair.
      //
      // `local_atoms` is still read as a fallback: a model that reverts to the old shape gets its
      // first declared atom used rather than a rejected chapter.
      const setbackObj = (typeof n.setback === 'object' && n.setback !== null && !Array.isArray(n.setback)
        ? n.setback
        : null) as Record<string, unknown> | null
      const legacyAtoms = c.arr(n.local_atoms ?? [], `${path}.local_atoms`, 0, MAX_LOCAL_ATOMS_PER_BEAT)
        .flatMap((a, ai) => {
          const at = c.obj(a, `${path}.local_atoms[${ai}]`)
          const name = typeof at.name === 'string' ? at.name.trim() : ''
          // Anything that is not an event is stored as a flag: both are claimable booleans, and
          // the alternative was discarding a whole chapter over one mislabelled setback.
          const akind: AtomKind = at.kind === 'event' ? 'event' : 'flag'
          return name ? [{ name, kind: akind }] : []
        })
      const setbackName = typeof setbackObj?.name === 'string' ? setbackObj.name.trim() : ''
      const declared: AtomProposal[] = setbackName
        ? [{ name: setbackName, kind: setbackObj?.kind === 'event' ? 'event' : 'flag' }]
        : legacyAtoms.slice(0, 1)
      localAtoms.push(...declared)
      // A SETBACK MAY ONLY SPEND LOCAL ATOMS. The failure menu deliberately excludes the
      // objective's own spine atoms: awarding one on failure means losing the scene COMPLETES the
      // objective, which is not a setback at all. Live 2026-07-27, "Breach the Harbourmaster's
      // Office" authored on_failure:["office_breached"] - the same atom as on_success - so the
      // objective finished whatever happened, and its second route and its rescue became content
      // the party could never reach. Nothing structural could see it: the failure map was
      // non-empty, the transitions were valid, and the atom was registered. The playability
      // prover found it by walking the paths.
      // The failure map is now DERIVED, not chosen. The node's one declared setback is what it
      // costs - there is no separate reference for the model to get wrong, and no way to name the
      // objective's own goal here, which is how "Breach the Harbourmaster's Office" ended up
      // completing itself on failure (2026-07-27; found by the playability prover, invisible to
      // every structural rule because the map was non-empty and the atom was registered).
      let repairedFailure = declared.map((a) => a.name)
      if (repairedFailure.length === 0) {
        // Nothing declared. Synthesize one readable, deterministic setback and register it, rather
        // than shipping a node with a free loss - which the stage-8 gate would (correctly) refuse,
        // taking the whole guide down over an omission code can fill in perfectly.
        const synthetic = canonicalizeAtomSlug(`${objective.title} attempt ${ni + 1} failed`)
        if (synthetic) {
          const atom: AtomProposal = { name: synthetic, kind: 'flag' }
          localAtoms.push(atom)
          repairedFailure = [synthetic]
        }
      }

      const npcKeys = (Array.isArray(n.npc_keys) ? n.npc_keys : [])
        .filter((k): k is string => typeof k === 'string' && npcKeySet.has(k))

      // Closed vocabulary, same contract as npc_keys: an off-list place is DROPPED, not invented.
      // A node with no location reads as "wherever the party is", which is the safe failure - the
      // unsafe one is a place that exists only in this field and that nothing can travel to.
      const authoredLocation = typeof n.location_key === 'string' ? n.location_key.trim() : ''
      const locationKey = locationKeySet.has(authoredLocation) ? authoredLocation : null
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

      // TRANSITIONS ARE DERIVED. The model no longer authors edges at all - it writes the setback
      // line and nothing else. Every edge shape it used to be able to express was a way to break
      // the graph: 68 `failed -> done` dead ends across 11 of 11 guides, self-loops that replayed
      // the same scene, indices pointing at nodes that did not exist.
      //
      // The ladder is the Three-Clue shape: a full success always resolves the objective (its
      // on_success IS the objective's minimal satisfying set), and a failure hands the party the
      // next route, or the rescue once the routes are spent. Deterministic, and provable - the
      // stage-8 prover walks exactly these edges.
      const setbackLine = typeof n.setback_line === 'string' ? n.setback_line.trim() : ''
      const legacyArrival = (Array.isArray(n.transitions) ? n.transitions : [])
        .flatMap((t) => (typeof t === 'object' && t !== null ? [t as Record<string, unknown>] : []))
        .find((t) => t.on === 'failed' && typeof t.arrival_context === 'string')
      const arrivalContext = setbackLine ||
        (typeof legacyArrival?.arrival_context === 'string' ? legacyArrival.arrival_context.trim() : '') ||
        'That attempt fails, and the party is forced to look for another way.'
      const transitions: NodeTransition[] = [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        {
          on: 'failed',
          toNodeKey: ni + 1 < nodeCount
            ? nodeKeyFor(objKey, 'route', ni + 1)
            : nodeKeyFor(objKey, 'rescue', 0),
          arrivalContext,
        },
      ]

      // A missing seed is thin, not fatal: stage 7 reads node prose and can rewrite it, and the
      // narrator still has the objective and stakes to open on. Failing here cost a whole guide.
      const authoredSeed = typeof n.narration_seed === 'string' ? n.narration_seed.trim() : ''
      const narrationSeed = authoredSeed ||
        `The party faces this directly: ${objective.title}.${stakes ? ` ${stakes}` : ''}`

      // WHAT IS TRUE AFTERWARDS. Absent is thin, not fatal - the same treatment narration_seed
      // gets - so a model that skips the field costs the guide a little context rather than the
      // whole chapter. The derived fallbacks are honest but bland, which is the point: they are
      // what a later scene reads when nobody wrote something better.
      const outcome = parseOutcomeSummary(n.outcome)
      const outcomeSummary = {
        win: outcome.win || `The party achieves this: ${objective.title}.`,
        loss: outcome.loss || arrivalContext,
      }

      // THE NARRATOR'S ORIENTATION LINE (2026-07-30). Left EMPTY when unauthored rather than
      // derived from the title - deliberately, because a derived one would be the objective
      // restated, which is the exact string this field exists to keep out of the prompt. An empty
      // pull falls back to `GOAL <title>` at read time, so an old guide behaves as it always has
      // and a new one that skips the field is no worse than an old one.
      const pull = typeof n.pull === 'string' ? n.pull.trim() : ''
      // Only what the MODEL wrote is held to the distinctness rule below. A derived fallback is
      // code's own filler, and two nodes sharing one is code repeating itself, not the author
      // giving two routes the same cost.
      if (outcome.loss) authoredLosses.push({ key: nodeKeyFor(objKey, 'route', ni), objKey, loss: outcome.loss })
      // The one rule code can decide, so code decides it. A setback that removes a cast member
      // contradicts the very scene the ladder hands the party next - and it is checked on BOTH
      // lines a failure travels on, because either one reaches the next node's narrator.
      // EVERY CONVERSATION MUST HAVE A WAY OUT THAT IS NOT A LOSS (2026-07-29).
      //
      // `socialExits` reads `params.exits`, and the guide pipeline had NEVER written that field -
      // so `runSocialExitJudge` returned null before its model call, the ceiling fallback found no
      // partial, and `exitTier(null)` resolved `failed`. 0 of 57 social route nodes across 23
      // guides had exits: every conversation ever played was a guaranteed loss, whatever the
      // player said.
      //
      // Synthesized when absent rather than rejected, exactly as the setback above is. An omitted
      // field is not worth failing a paid generation over, and shipping a social node with no way
      // out is the specific bug this exists to end - so the fallback is deterministic and always
      // leaves a non-failure exit.
      const socialExits = resolvedKind === 'social' ? parseSocialExits(n.exits, objective.title) : []

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
        locationKey,
        encounter: {
          kind: resolvedKind, label: objective.title, stakes, rationale: '',
          // npc_ids are merged in at storage time (stages-content.ts storedSpec), which spreads
          // whatever is already here - so authored exits ride along untouched.
          params: (socialExits.length > 0 ? { exits: socialExits } : {}) as Json,
          // FLAVOUR ONLY (2026-07-29). The plot fact moved to `establishes`; what remains here is
          // the price and the colour. Empty on success because nothing yet authors a win-only
          // reward - when something does, this is where it goes, and it must never contain an
          // atom the objective's predicate reads.
          onSuccess: [],
          // Pass or fail (2026-07-27): nothing authors or reads a partial map any more. The field
          // stays on the type so stored rows still parse; it is always empty going forward.
          onPartial: [],
          onFailure: repairedFailure,
        },
        establishes,
        outcomeSummary,
        pull,
        affordances,
        transitions,
        localAtoms: declared,
      }
      nodes.push({ node, npcKeys })
    })
  }

  // TWO ROUTES MAY NOT COST THE SAME THING. Decidable where "does this loss end the story?" is
  // not, and it catches the shape that matters: live on guide ac78e517 both routes of the climax
  // carried the identical loss - "the Drowned Corpus completes its manifestation, Mirehaven
  // silenced and its people preserved in brine" - which is the objective lost outright, recorded
  // twice, on routes whose whole purpose is to lead onward. A reused sentence is the reliable
  // signal that the model wrote the objective's defeat instead of this scene's cost.
  const lossSeen = new Map<string, string>()
  for (const { key, objKey, loss } of authoredLosses) {
    const fingerprint = `${objKey} ${loss.trim().toLowerCase()}`
    const first = lossSeen.get(fingerprint)
    if (first) {
      c.errors.push(
        `$.objectives: nodes "${first}" and "${key}" declare the SAME loss. A setback is where a ` +
          "route's identity lives - give each one its own cost, and make it what that attempt cost " +
          'the party, never the objective being lost outright.',
      )
    } else {
      lossSeen.set(fingerprint, key)
    }
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

  // An unplaced node is a node the runtime cannot tell the party they still have to reach, so it
  // gets narrated as though they were already standing in it. Only worth asking for when the
  // chapter actually has places to choose from - a location-less chapter has no right answer, and
  // failing it would take the whole guide down over something the model could not supply.
  if (ctx.locations.length > 0) {
    for (const { node } of nodes) {
      if (node.locationKey) continue
      c.errors.push(
        `$.objectives: node "${node.key}" has no valid location_key - pick one of: ` +
          ctx.locations.map((l) => l.key).join(', '),
      )
    }
  }

  return c.result({ nodes, localAtoms })
}
