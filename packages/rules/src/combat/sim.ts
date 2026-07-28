// Batch simulation harness (F09 SS10 tuning). Runs a CombatManifest headless over a fixed set of
// seeds and aggregates the numbers a balance pass needs: win rate, tier split, rounds, casualties,
// and the margin the party wins by. Pure and deterministic - same seeds in, same summary out - so
// a sweep is a reproducible measurement, not a sample.
//
// runFight IS the live resolution loop (session/combat.ts calls it): the harness measures the code
// path that actually runs in play, so a tuning verdict here transfers.

import type { Rng } from '../play/rng.ts'
import { seededRng } from '../play/rng.ts'
import { createCombat } from './engine.ts'
import { runAutoTurn } from './heuristic.ts'
import { deriveResult, fightIsOver, manifestToSetup } from './manifest.ts'
import type { CombatManifest, CombatResult } from './manifest.ts'
import type { CombatEngineState, DifficultySetting } from './types.ts'

/** Well above any real fight; hitting it means the fight cannot resolve (see FightOutcome.stalled). */
export const DEFAULT_TURN_CAP = 1000

export interface FightOutcome {
  seed: number
  state: CombatEngineState
  result: CombatResult
  rounds: number
  /** Auto-turns played before the fight resolved or the cap hit. */
  turns: number
  /** Cap hit with the fight still live - a stalemate, which is NOT the same as a defeat. */
  stalled: boolean
}

/**
 * Resolve one whole fight headless with the minion heuristic driving every combatant. Throws
 * (CombatError) on an unbuildable manifest - callers decide whether that is fatal or a data point.
 */
export function runFight(manifest: CombatManifest, seed: number, turnCap = DEFAULT_TURN_CAP): FightOutcome {
  const rng: Rng = seededRng(seed)
  let { state } = createCombat(manifestToSetup(manifest), rng)
  let turns = 0
  while (turns < turnCap && !fightIsOver(state, manifest.bossRef)) {
    state = runAutoTurn(state, rng).state
    turns++
  }
  return {
    seed,
    state,
    turns,
    rounds: state.round,
    stalled: !fightIsOver(state, manifest.bossRef),
    result: deriveResult(state, { bossRef: manifest.bossRef }),
  }
}

export interface RunRecord {
  seed: number
  outcome: CombatResult['outcome']
  tier: CombatResult['tier']
  rounds: number
  stalled: boolean
  /** Party members ending dead or unconscious. */
  pcDown: number
  /** Party members who withdrew alive - a retreat instead of a wipe. */
  pcFled: number
  enemyDown: number
  enemyFled: number
  /** Party HP left as a fraction of party max HP - how much margin the win had. */
  partyHp: number
  bossDown: boolean
}

function toRecord(fight: FightOutcome, bossRef: string | null): RunRecord {
  const party = fight.state.combatants.filter((c) => c.side === 'party')
  const hpMax = party.reduce((sum, c) => sum + c.hp.max, 0)
  const boss = bossRef ? fight.state.combatants.find((c) => c.id === bossRef) : null
  return {
    seed: fight.seed,
    outcome: fight.result.outcome,
    tier: fight.result.tier,
    rounds: fight.rounds,
    stalled: fight.stalled,
    pcDown: party.filter((c) => c.dead || c.conditions.includes('unconscious')).length,
    pcFled: party.filter((c) => c.fled && !c.dead && !c.conditions.includes('unconscious')).length,
    enemyDown: fight.state.combatants.filter((c) => c.side === 'enemy' && c.dead).length,
    enemyFled: fight.state.combatants.filter((c) => c.side === 'enemy' && c.fled && !c.dead).length,
    partyHp: hpMax > 0 ? party.reduce((sum, c) => sum + c.hp.current, 0) / hpMax : 0,
    bossDown: !!boss?.dead,
  }
}

export interface Stats {
  mean: number
  median: number
  p10: number
  p90: number
  min: number
  max: number
}

const ZERO_STATS: Stats = { mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 }

/** Nearest-rank percentiles - no interpolation, so every reported number is an observed one. */
function stats(values: number[]): Stats {
  if (values.length === 0) return ZERO_STATS
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

export interface SimSummary {
  label: string
  difficulty: string
  /** Seeds attempted (including any that threw). */
  runs: number
  /** Fraction of resolved runs the party won. Stalled and errored runs are excluded. */
  winRate: number
  tierRates: { full: number; partial: number; failed: number }
  /** Fraction of resolved runs where the whole party went down. */
  tpkRate: number
  /** Fraction of resolved LOSSES the party walked away from - a retreat rather than a wipe. */
  retreatRate: number
  stalledRate: number
  errorRate: number
  /** Distinct error messages, so a broken manifest is visible instead of silently zero-win. */
  errors: string[]
  rounds: Stats
  pcDown: Stats
  partyHp: Stats
  /** Every run, for callers that want the raw distribution. */
  records: RunRecord[]
}

export interface SimOptions {
  label?: string
  /** Seed count; seeds default to 1..runs so two sweeps compare on the SAME fights. */
  runs?: number
  seeds?: number[]
  /** Resolve the manifest under this setting instead of its own. */
  difficulty?: DifficultySetting
  turnCap?: number
}

export function simSeeds(opts: SimOptions = {}): number[] {
  return opts.seeds ?? Array.from({ length: opts.runs ?? 200 }, (_, i) => i + 1)
}

/** Run one manifest over many seeds and aggregate. Never throws: a failing seed becomes an error row. */
export function simulate(manifest: CombatManifest, opts: SimOptions = {}): SimSummary {
  const target = opts.difficulty ? { ...manifest, difficulty: opts.difficulty } : manifest
  const seeds = simSeeds(opts)
  const records: RunRecord[] = []
  const errors = new Set<string>()

  for (const seed of seeds) {
    try {
      records.push(toRecord(runFight(target, seed, opts.turnCap), target.bossRef))
    } catch (e) {
      errors.add(e instanceof Error ? e.message : String(e))
    }
  }

  const resolved = records.filter((r) => !r.stalled)
  const partySize = target.party.length
  const rate = (n: number) => (resolved.length > 0 ? n / resolved.length : 0)
  const tier = (name: RunRecord['tier']) => rate(resolved.filter((r) => r.tier === name).length)
  const losses = resolved.filter((r) => r.outcome === 'defeat')

  return {
    label: opts.label ?? target.encounterId ?? 'fight',
    difficulty: target.difficulty.name,
    runs: seeds.length,
    winRate: rate(resolved.filter((r) => r.outcome === 'victory').length),
    tierRates: { full: tier('full'), partial: tier('partial'), failed: tier('failed') },
    tpkRate: rate(resolved.filter((r) => partySize > 0 && r.pcDown >= partySize).length),
    retreatRate: losses.length > 0 ? losses.filter((r) => r.pcFled > 0).length / losses.length : 0,
    stalledRate: seeds.length > 0 ? records.filter((r) => r.stalled).length / seeds.length : 0,
    errorRate: seeds.length > 0 ? (seeds.length - records.length) / seeds.length : 0,
    errors: [...errors],
    rounds: stats(resolved.map((r) => r.rounds)),
    pcDown: stats(resolved.map((r) => r.pcDown)),
    partyHp: stats(resolved.map((r) => r.partyHp)),
    records,
  }
}

/** The same seed set under every preset - a paired comparison, so differences are the dial, not noise. */
export function sweepDifficulty(
  manifest: CombatManifest,
  presets: DifficultySetting[],
  opts: SimOptions = {},
): SimSummary[] {
  const seeds = simSeeds(opts)
  return presets.map((difficulty) => simulate(manifest, { ...opts, seeds, difficulty }))
}
