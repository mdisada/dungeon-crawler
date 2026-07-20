// Puzzle encounters (encounter-states Slice 5): the puzzle scene mode earns its name. The
// spec holds a SECRET solution + 2-4 steps (each with an unlockable hint) + a fail
// consequence that always escalates. Attempts route through the Puzzle Judge with the
// solution in context; the pure engine (_shared/play/puzzle.ts) counts progress, hints, and
// the mistake budget. scene.mode = 'puzzle' while active.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { newPuzzle, puzzleSolvedTier, recordPuzzleAttempt } from '../_shared/play/index.ts'
import type { PuzzleProgress } from '../_shared/play/index.ts'
import type { EncounterState, Json } from '../_shared/state/index.ts'
import { runPuzzleJudge } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import {
  activeEncounter, handleEncounterTalk, newEncounter, openEncounter, resolveOpenEncounter,
  runCombatPlaceholderEncounter,
} from './encounters.ts'
import type { StoredBeatSpec } from './encounters.ts'
import { narrationBeat } from './narration.ts'
import { activePcIds, appendLinesDiff, newLine, typingDiff } from './orchestrate.ts'
import type { CharacterRow } from './orchestrate.ts'
import { antagonistTurn } from './steward.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

interface PuzzleStep {
  description: string
  hint: string
}

interface PuzzleSpec {
  solution: string
  steps: PuzzleStep[]
  maxAttempts: number
  failConsequence: { kind: 'spawn_encounter' | 'cost' | 'antagonist_step'; params: Record<string, Json> }
}

export function puzzleSpec(params: Record<string, Json>): PuzzleSpec {
  const stepsRaw = Array.isArray(params.steps) ? params.steps : []
  const steps = stepsRaw.flatMap((s): PuzzleStep[] => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return []
    const step = s as Record<string, Json>
    if (typeof step.description !== 'string' || !step.description.trim()) return []
    return [{ description: step.description, hint: typeof step.hint === 'string' ? step.hint : '' }]
  }).slice(0, 4)
  const fcRaw = (typeof params.fail_consequence === 'object' && params.fail_consequence !== null && !Array.isArray(params.fail_consequence)
    ? params.fail_consequence
    : {}) as Record<string, Json>
  const kind = fcRaw.kind === 'spawn_encounter' || fcRaw.kind === 'cost' ? fcRaw.kind : 'antagonist_step'
  return {
    solution: typeof params.solution === 'string' ? params.solution : '',
    steps: steps.length > 0 ? steps : [{ description: 'Work out the mechanism', hint: 'Look closer at what moves.' }],
    maxAttempts: typeof params.max_attempts === 'number' ? params.max_attempts : 3,
    failConsequence: {
      kind,
      params: (typeof fcRaw.params === 'object' && fcRaw.params !== null && !Array.isArray(fcRaw.params)
        ? fcRaw.params
        : {}) as Record<string, Json>,
    },
  }
}

function puzzleFromEncounter(encounter: EncounterState): PuzzleProgress {
  const p = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
    ? encounter.progress
    : {}) as Record<string, Json>
  const num = (v: Json | undefined, fallback: number) => (typeof v === 'number' ? v : fallback)
  return {
    stepsTotal: num(p.stepsTotal, 2),
    stepsDone: num(p.stepsDone, 0),
    attemptsLeft: num(p.attemptsLeft, 3),
    hintsUnlocked: num(p.hintsUnlocked, 0),
    lastAttemptBy: typeof p.lastAttemptBy === 'string' ? p.lastAttemptBy : null,
    contributions: encounter.contributions,
    activePcIds: Array.isArray(p.activePcIds)
      ? (p.activePcIds as Json[]).filter((s): s is string => typeof s === 'string')
      : [],
  }
}

function puzzleProgressJson(p: PuzzleProgress): Json {
  return {
    stepsTotal: p.stepsTotal,
    stepsDone: p.stepsDone,
    attemptsLeft: p.attemptsLeft,
    hintsUnlocked: p.hintsUnlocked,
    lastAttemptBy: p.lastAttemptBy,
    activePcIds: p.activePcIds,
  }
}

/** Instantiates a puzzle frame from a stored spec and flips the scene into puzzle mode. */
export async function openPuzzleFromSpec(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  spec: StoredBeatSpec,
): Promise<EncounterState> {
  const parsed = puzzleSpec(spec.params)
  const progress = newPuzzle({
    stepsTotal: parsed.steps.length,
    maxAttempts: parsed.maxAttempts,
    activePcIds: await activePcIds(service, env.adventureId),
  })
  const encounter = newEncounter('puzzle', spec.label, spec.stakes, puzzleProgressJson(progress))
  await openEncounter(service, env.adventureId, sessionId, encounter, {
    onSuccess: spec.onSuccess, onPartial: spec.onPartial, onFailure: spec.onFailure, params: spec.params,
  })
  await commitDiffs(service, env.adventureId, () => [{ domain: 'scene', patch: { mode: 'puzzle' } }])
  return encounter
}

/** The action route while a puzzle is open: judge the attempt, count it, narrate. */
export async function handlePuzzleIntent(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  opts?: { lineAlreadyStaged?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (!encounter || encounter.kind !== 'puzzle') {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    return { status: 409, body: { error: 'No puzzle is open' } }
  }
  const spec = puzzleSpec((state.dm?.encounterSpec?.params ?? {}) as Record<string, Json>)
  const progress = puzzleFromEncounter(encounter)

  let judgment
  try {
    judgment = await runPuzzleJudge(env, {
      solution: spec.solution,
      steps: spec.steps.map((s, i) => ({ description: s.description, done: i < progress.stepsDone })),
      attempt: text,
      actorName: character.name,
    })
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }

  if (judgment.result === 'talk') {
    // A question, not an attempt (unified input): answer it; the mistake budget is untouched.
    return handleEncounterTalk(service, env, sessionId, character, text, { lineAlreadyStaged: true })
  }

  const { state: next, status, newHintUnlocked } = recordPuzzleAttempt(progress, character.id, judgment.result)
  await commitDiffs(service, env.adventureId, () => [
    {
      domain: 'encounter',
      patch: { progress: puzzleProgressJson(next), contributions: next.contributions as unknown as Json },
    },
  ])
  await logEvent(service, env.adventureId, sessionId, 'encounter_attempt', {
    encounter_id: encounter.id, kind: 'puzzle', character_id: character.id,
    result: judgment.result, steps_done: next.stepsDone, attempts_left: next.attemptsLeft, status,
  })

  if (status === 'ongoing') {
    const hint = newHintUnlocked ? spec.steps[Math.min(next.hintsUnlocked, spec.steps.length) - 1]?.hint : ''
    await narrationBeat(
      service, env, sessionId,
      `Narrate this puzzle attempt. ${character.name} tries: ${text}. ` +
        `${judgment.result === 'advances_step' ? `It WORKS - a piece falls into place (${judgment.note}).` : `It fails (${judgment.note}).`} ` +
        `Progress: ${next.stepsDone}/${next.stepsTotal} steps, ${next.attemptsLeft} ${next.attemptsLeft === 1 ? 'mistake' : 'mistakes'} to spare. ` +
        (hint ? `Work in this hint as an in-fiction detail the party notices: "${hint}". ` : '') +
        'Never reveal the solution itself. Keep the puzzle live and demanding their next idea.',
      'Puzzle attempt',
      'outcome',
    )
    return { status: 200, body: { ok: true, resolved: 'puzzle_attempt', result: judgment.result, puzzle_status: status } }
  }

  if (status === 'solved') {
    await resolveOpenEncounter(
      service, env, sessionId, puzzleSolvedTier(next),
      `${character.name}'s attempt (${text}) cracked it: ${judgment.note || 'the mechanism yields'}. ` +
        'The puzzle is solved - show the solution working now that they have earned it.',
    )
    return { status: 200, body: { ok: true, resolved: 'puzzle_solved', tier: puzzleSolvedTier(next) } }
  }

  // Exhausted: the authored consequence ESCALATES - never "nothing happens".
  await resolveOpenEncounter(
    service, env, sessionId, 'failed',
    `The party's ideas ran out (${judgment.note || 'the last attempt failed'}) - the puzzle beat them.`,
  )
  await executeFailConsequence(service, env, sessionId, encounter.label, spec)
  return { status: 200, body: { ok: true, resolved: 'puzzle_failed', consequence: spec.failConsequence.kind } }
}

async function executeFailConsequence(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  label: string,
  spec: PuzzleSpec,
): Promise<void> {
  const { kind, params } = spec.failConsequence
  await logEvent(service, env.adventureId, sessionId, 'puzzle_consequence', { label, kind })
  if (kind === 'cost') {
    const gold = typeof params.gold === 'number' ? Math.max(0, Math.round(params.gold)) : 10
    await commitDiffs(service, env.adventureId, (s) => [
      { domain: 'players', patch: { gold: Math.max(0, s.players.gold - gold) } },
      appendLinesDiff(s, [newLine(null, null, `The failure costs the party dearly: -${gold} gold.`)]),
    ])
    return
  }
  if (kind === 'antagonist_step') {
    try {
      await antagonistTurn(service, env, sessionId, 'puzzle_failure')
    } catch (err) {
      console.error('puzzle-failure antagonist turn failed', err)
    }
    return
  }
  // spawn_encounter: the combat placeholder carries it until the Slice 6 random-encounter
  // machinery takes over spawning.
  await runCombatPlaceholderEncounter(service, env, sessionId, {
    kind: 'combat',
    label: typeof params.label === 'string' && params.label.trim() ? params.label : `Drawn by the noise at ${label}`,
    stakes: '',
    params: {},
    onSuccess: [],
    onPartial: [],
    onFailure: [],
  })
}
