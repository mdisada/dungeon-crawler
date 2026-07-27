// Playability prover (2026-07-27): an exhaustive, deterministic, $0 model check of the authored
// graph, run at stage 8 before `guide_ready`.
//
// WHY THIS EXISTS. Every structural bug this month was found by a player, then fixed by adding a
// lint rule for that exact shape - dead-end transitions, free failures, non-escalating self-loops.
// A linter only catches what somebody already thought to write a rule about, so the cycle repeats
// with the next shape nobody predicted. This asks the question the rules were all approximating:
// walk EVERY path through the graph and check that the party can still finish.
//
// HOW IT CANNOT DRIFT. It drives the real `nextNode` rather than reimplementing navigation, so the
// graph is proved against the same function the session runs. A change to the navigator's
// fall-through, replay-blocking or rescue behaviour is immediately reflected here - a
// reimplementation would have silently gone stale the moment either side moved.
//
// WHY IT TRACKS ATOMS. Reachability alone is not enough, and the 2026-07-26 dead end proves it:
// `failed -> null` made the navigator report `objective_done`, so a purely structural walk would
// have called that path a SUCCESS. Only by carrying the awarded atoms and testing the objective's
// own predicate at each terminal does "the navigator says we are finished" become distinguishable
// from "the objective is actually complete".
//
// The state space is tiny (<=5 nodes per objective, and both `used` and `atoms` grow
// monotonically, so the graph of states is a DAG) - microseconds, no LLM, no network.

import { nextNode } from '../story/navigate.ts'
import type { NavNode, NavTier } from '../story/navigate.ts'
import { atomsSatisfy } from './guaranteed-route.ts'

/** Both outcome tiers a resolved node can produce (pass/fail, 2026-07-27). */
const TIERS: readonly NavTier[] = ['full', 'failed']

/** Hard ceiling on explored states - a runaway means a navigator bug, and hanging the guide
 *  pipeline is worse than reporting one. */
const MAX_STATES = 20_000

export interface ProvableNode extends NavNode {
  onSuccess: readonly string[]
  onFailure: readonly string[]
}

export type ProofCode =
  /** No sequence of outcomes completes the objective - the guide is unfinishable as authored. */
  | 'objective_unwinnable'
  /** The graph declares the objective resolved on a path whose atoms do not satisfy it. */
  | 'resolves_without_completing'
  /** A state the party can genuinely reach from which completion is no longer possible. */
  | 'unwinnable_state'
  /** Authored content no path can ever open. */
  | 'node_unreachable'
  /** The walk hit the state ceiling - report rather than hang. */
  | 'proof_incomplete'

export interface ProofFinding {
  code: ProofCode
  objectiveId: string
  message: string
  /** The outcome sequence that demonstrates it, e.g. ["n0:failed", "n1:failed"]. */
  path?: string[]
}

interface WalkState {
  fromKey: string | null
  tier: NavTier | null
  used: readonly string[]
  atoms: readonly string[]
  path: readonly string[]
}

const stateKey = (s: WalkState) =>
  `${s.fromKey ?? '-'}|${s.tier ?? '-'}|${[...s.used].sort().join(',')}|${[...s.atoms].sort().join(',')}`

/**
 * Atoms are carried EXACTLY as authored - no canonicalization.
 *
 * Predicates store the raw text ("party obtained the partial ledger copy"), `atomsSatisfy` matches
 * on that text, and the runtime's `listMilestoneAtoms` speaks the same currency. Slugging the
 * awarded atoms here made every real predicate unsatisfiable and reported two perfectly good
 * objectives as unwinnable - a false alarm that would have blocked generation outright. The
 * fixtures all used slug-shaped names, so only running this against a real guide exposed it.
 */
const award = (atoms: readonly string[], add: readonly string[]): string[] =>
  [...new Set([...atoms, ...add.filter((a) => a.trim().length > 0)])]

export interface ProveObjectiveInput {
  objectiveId: string
  title: string
  /** The objective's completion predicate, exactly as stored. */
  completionPredicates: unknown
  nodes: readonly ProvableNode[]
}

/**
 * Exhaustively walk one objective's graph and report every way it can fail a player.
 *
 * `satisfied` treats an already-complete state as terminal-good: once the awarded atoms meet the
 * predicate the objective IS done, whatever the navigator does next.
 */
export function proveObjective(input: ProveObjectiveInput): ProofFinding[] {
  const { objectiveId, title, completionPredicates, nodes } = input
  const findings: ProofFinding[] = []
  if (nodes.length === 0) return findings

  const navNodes: NavNode[] = nodes.map((n) => ({
    id: n.id, key: n.key, objectiveId: n.objectiveId, index: n.index, role: n.role,
    transitions: n.transitions,
  }))
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const satisfied = (atoms: readonly string[]) => atomsSatisfy(completionPredicates, [...atoms])

  const reached = new Set<string>()
  const canFinish = new Map<string, boolean>()
  const falseClaims: { path: string[]; atoms: readonly string[] }[] = []
  let states = 0
  let overflowed = false

  /** Can the party still complete the objective from here? Memoized; the state graph is a DAG. */
  function canComplete(s: WalkState): boolean {
    if (satisfied(s.atoms)) return true
    const key = stateKey(s)
    const memo = canFinish.get(key)
    if (memo !== undefined) return memo
    if (++states > MAX_STATES) { overflowed = true; return true }
    // Provisional false guards against re-entry; the state graph is acyclic, so this is only
    // reached if the navigator itself starts cycling - which the ceiling above catches.
    canFinish.set(key, false)

    const decision = nextNode({
      nodes: navNodes, fromKey: s.fromKey, tier: s.tier, usedKeys: [...s.used],
    })

    let ok = false
    if (decision.action === 'open') {
      const node = byKey.get(decision.node.key)
      reached.add(decision.node.key)
      for (const tier of TIERS) {
        const gained = tier === 'full' ? (node?.onSuccess ?? []) : (node?.onFailure ?? [])
        const child: WalkState = {
          fromKey: decision.node.key,
          tier,
          used: [...s.used, decision.node.key],
          atoms: award(s.atoms, gained),
          path: [...s.path, `${decision.node.key}:${tier}`],
        }
        if (canComplete(child)) ok = true
      }
    } else if (decision.reason === 'objective_done') {
      // The graph says the objective resolves here, but the atoms say otherwise. This is exactly
      // the 2026-07-26 dead end, and a structure-only check would have scored it a success.
      falseClaims.push({ path: [...s.path], atoms: s.atoms })
      ok = false
    }
    // `exhausted` is a legitimate outcome for a party that failed everything - it just is not a
    // completion, so it contributes nothing to `ok`.

    canFinish.set(key, ok)
    return ok
  }

  const start: WalkState = { fromKey: null, tier: null, used: [], atoms: [], path: [] }
  const winnable = canComplete(start)

  if (overflowed) {
    findings.push({
      code: 'proof_incomplete', objectiveId,
      message: `"${title}": the playability walk exceeded ${MAX_STATES} states and was abandoned. ` +
        'That points at a navigator cycle, not a large graph - every objective here has at most a ' +
        'handful of nodes.',
    })
    return findings
  }

  if (!winnable) {
    findings.push({
      code: 'objective_unwinnable', objectiveId,
      message: `"${title}" cannot be completed by ANY sequence of outcomes. No path through its ` +
        'authored nodes awards the atoms its completion predicate requires.',
    })
  }

  for (const claim of falseClaims) {
    findings.push({
      code: 'resolves_without_completing', objectiveId,
      path: claim.path,
      message: `"${title}" is reported resolved after ${claim.path.join(' -> ') || 'no scenes'}, but ` +
        `the atoms awarded (${claim.atoms.join(', ') || 'none'}) do not satisfy its completion ` +
        'predicate. The party is left in a finished scene with the objective still open.',
    })
  }

  for (const node of nodes) {
    if (!reached.has(node.key)) {
      findings.push({
        code: 'node_unreachable', objectiveId,
        message: `Node "${node.key}" can never open: no sequence of outcomes reaches it. It is ` +
          'authored content the party will never see.',
      })
    }
  }

  return findings
}

export interface ProveGraphInput {
  objectives: readonly { id: string; title: string; completionPredicates: unknown }[]
  nodes: readonly ProvableNode[]
}

/** Proves every objective that has authored nodes. Legacy objectives (no nodes) are skipped. */
export function proveGraph(input: ProveGraphInput): ProofFinding[] {
  return input.objectives.flatMap((o) =>
    proveObjective({
      objectiveId: o.id,
      title: o.title,
      completionPredicates: o.completionPredicates,
      nodes: input.nodes.filter((n) => n.objectiveId === o.id),
    }))
}
