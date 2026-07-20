// Merge-patch diff application (F06 SS6). The client store and the server-side single writer
// run the exact same function, so a resync hash can prove both ended at identical state.

import type { DiffDomain, GameState, Json, StateDiff } from './types.ts'

function isPlainObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** RFC 7386 merge patch: objects merge recursively, null deletes, everything else replaces. */
export function mergePatch(target: Json, patch: Json): Json {
  if (!isPlainObject(patch)) return patch
  const base: { [key: string]: Json } = isPlainObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key]
    else base[key] = mergePatch(base[key] ?? null, value)
  }
  return base
}

const NULLABLE_DOMAINS: readonly DiffDomain[] = ['combat', 'dm', 'encounter']

/**
 * Applies one diff to a GameState. For nullable domains (combat, dm, encounter) a `null`
 * patch clears the domain outright; for the rest, null resets nothing (the writer never
 * emits it).
 */
export function applyDiff(state: GameState, diff: StateDiff): GameState {
  const current = state[diff.domain] as Json
  if (diff.patch === null && NULLABLE_DOMAINS.includes(diff.domain)) {
    return { ...state, [diff.domain]: null }
  }
  return { ...state, [diff.domain]: mergePatch(current, diff.patch) }
}

export function applyDiffs(state: GameState, diffs: StateDiff[]): GameState {
  return diffs.reduce(applyDiff, state)
}
