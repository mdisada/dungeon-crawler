// Loop Stack Manager operations (F08 SS2): pure transitions over the core-loop stack. The
// session function persists the returned rows; nothing here touches a database. Invariant: at
// most one loop is 'active'; push suspends the incumbent, complete auto-resumes the topmost
// suspended loop so play never lands without an active loop while any remain.

import type { CoreLoop, LoopType } from './types.ts'

export type LoopOpResult =
  | { ok: true; loops: CoreLoop[]; resumedId: string | null }
  | { ok: false; error: string }

export function activeLoop(loops: CoreLoop[]): CoreLoop | null {
  return loops.find((l) => l.status === 'active') ?? null
}

function replace(loops: CoreLoop[], next: CoreLoop): CoreLoop[] {
  return loops.map((l) => (l.id === next.id ? next : l))
}

export interface LoopSeed {
  id: string
  type: LoopType
  customLabel: string | null
}

/** Push a new loop: incumbent active loop suspends (beat position preserved), new loop leads. */
export function pushLoop(loops: CoreLoop[], seed: LoopSeed): LoopOpResult {
  if (loops.some((l) => l.id === seed.id)) return { ok: false, error: `loop ${seed.id} already on the stack` }
  const top = Math.max(0, ...loops.map((l) => l.stackPosition))
  let next = loops
  const incumbent = activeLoop(loops)
  if (incumbent) next = replace(next, { ...incumbent, status: 'suspended' })
  next = [...next, {
    id: seed.id,
    type: seed.type,
    status: 'active',
    stackPosition: top + 1,
    currentBeatId: null,
    customLabel: seed.customLabel,
  }]
  return { ok: true, loops: next, resumedId: null }
}

export function suspendLoop(loops: CoreLoop[], loopId: string): LoopOpResult {
  const loop = loops.find((l) => l.id === loopId)
  if (!loop) return { ok: false, error: `loop ${loopId} not found` }
  if (loop.status !== 'active') return { ok: false, error: `loop ${loopId} is ${loop.status}, not active` }
  return { ok: true, loops: replace(loops, { ...loop, status: 'suspended' }), resumedId: null }
}

export function resumeLoop(loops: CoreLoop[], loopId: string): LoopOpResult {
  const loop = loops.find((l) => l.id === loopId)
  if (!loop) return { ok: false, error: `loop ${loopId} not found` }
  if (loop.status !== 'suspended') return { ok: false, error: `loop ${loopId} is ${loop.status}, not suspended` }
  const incumbent = activeLoop(loops)
  if (incumbent) return { ok: false, error: `loop ${incumbent.id} is still active - suspend or complete it first` }
  return { ok: true, loops: replace(loops, { ...loop, status: 'active' }), resumedId: null }
}

/**
 * Complete a loop. If it was the active one, the topmost suspended loop (highest stack
 * position) resumes at its preserved beat; `resumedId` reports which, or null if none remain.
 */
export function completeLoop(loops: CoreLoop[], loopId: string): LoopOpResult {
  const loop = loops.find((l) => l.id === loopId)
  if (!loop) return { ok: false, error: `loop ${loopId} not found` }
  if (loop.status === 'completed') return { ok: false, error: `loop ${loopId} is already completed` }
  let next = replace(loops, { ...loop, status: 'completed' })
  let resumedId: string | null = null
  if (loop.status === 'active') {
    const successor = next
      .filter((l) => l.status === 'suspended')
      .sort((a, b) => b.stackPosition - a.stackPosition)[0]
    if (successor) {
      next = replace(next, { ...successor, status: 'active' })
      resumedId = successor.id
    }
  }
  return { ok: true, loops: next, resumedId }
}

/** Advance the active loop to a new beat. Only the active loop moves its beat pointer. */
export function advanceBeat(loops: CoreLoop[], loopId: string, beatId: string): LoopOpResult {
  const loop = loops.find((l) => l.id === loopId)
  if (!loop) return { ok: false, error: `loop ${loopId} not found` }
  if (loop.status !== 'active') return { ok: false, error: `loop ${loopId} is ${loop.status} - only the active loop advances beats` }
  return { ok: true, loops: replace(loops, { ...loop, currentBeatId: beatId }), resumedId: null }
}
