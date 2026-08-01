/**
 * The gate, as pure state. No React, no network - so the rule that decides when a player may read
 * on is testable on its own.
 *
 * One idea does all the work: `settledCount` is a PREFIX, the number of leading chunks that will
 * never change again (ready, failed, or timed out). Readiness is therefore always in order no
 * matter what order the broadcasts arrive in - chunk 4 landing before chunk 3 advances nothing.
 * The server releases in order too, but the client does not depend on it.
 */

export type NarrationChunkStatus = 'pending' | 'ready' | 'failed' | 'timeout'

export interface NarrationChunkState {
  index: number
  status: NarrationChunkStatus
  url: string | null
  /** True when the clip came back from the cache rather than being synthesized for this request. */
  cached: boolean
  /** Client-observed ms from the request starting to this chunk settling. */
  settledMs: number | null
  /** Server-reported synthesis ms. Null for cache hits and failures. */
  serverMs: number | null
  error: string | null
}

export type NarrationPhase = 'idle' | 'requesting' | 'active' | 'silent' | 'error'

export interface NarrationState {
  lineId: string | null
  phase: NarrationPhase
  chunks: NarrationChunkState[]
  /** Cumulative server marks before the first Fish call - measured ~1.0s, invisible from here. */
  serverTimings: Record<string, number> | null
  error: string | null
}

export type NarrationAction =
  | { type: 'reset' }
  | { type: 'start'; lineId: string; count: number }
  | { type: 'silent' }
  | {
      type: 'planned'
      chunks: { index: number; url: string | null }[]
      timings: Record<string, number>
      atMs: number
    }
  | { type: 'ready'; index: number; url: string; atMs: number; serverMs: number | null }
  | { type: 'failed'; index: number; error: string; atMs: number }
  | { type: 'timeout'; index: number; atMs: number }
  | { type: 'error'; message: string }

export const initialNarrationState: NarrationState = {
  lineId: null,
  phase: 'idle',
  chunks: [],
  serverTimings: null,
  error: null,
}

function pending(count: number): NarrationChunkState[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    status: 'pending' as const,
    url: null,
    cached: false,
    settledMs: null,
    serverMs: null,
    error: null,
  }))
}

/** Settling is one-way: a late broadcast for a chunk the deadline already released is ignored. */
function settle(
  state: NarrationState,
  index: number,
  patch: Partial<NarrationChunkState> & { status: NarrationChunkStatus },
): NarrationState {
  const chunk = state.chunks[index]
  if (!chunk || chunk.status !== 'pending') return state
  const chunks = [...state.chunks]
  chunks[index] = { ...chunk, ...patch }
  return { ...state, chunks }
}

export function narrationReducer(state: NarrationState, action: NarrationAction): NarrationState {
  switch (action.type) {
    case 'reset':
      return initialNarrationState
    case 'start':
      return {
        lineId: action.lineId,
        phase: 'requesting',
        chunks: pending(action.count),
        serverTimings: null,
        error: null,
      }
    case 'silent':
      return { ...state, phase: 'silent' }
    case 'planned': {
      // Cache hits come back in the response body itself, already playable.
      let next: NarrationState = { ...state, phase: 'active', serverTimings: action.timings }
      for (const chunk of action.chunks) {
        if (!chunk.url) continue
        next = settle(next, chunk.index, {
          status: 'ready',
          url: chunk.url,
          cached: true,
          settledMs: action.atMs,
        })
      }
      return next
    }
    case 'ready':
      return settle(state, action.index, {
        status: 'ready',
        url: action.url,
        settledMs: action.atMs,
        serverMs: action.serverMs,
      })
    case 'failed':
      return settle(state, action.index, { status: 'failed', settledMs: action.atMs, error: action.error })
    case 'timeout':
      return settle(state, action.index, { status: 'timeout', settledMs: action.atMs })
    case 'error':
      return { ...state, phase: 'error', error: action.message }
    default:
      return state
  }
}

/**
 * How many leading chunks are settled - the only number the gate needs.
 *
 * `silent` and `error` settle everything at once: a line with no voice, or a request that never
 * got off the ground, must never hold the story. That is the same guarantee the per-chunk deadline
 * gives for the slow case, applied to the cases we learn about immediately.
 */
export function settledCount(state: NarrationState): number {
  if (state.phase === 'silent' || state.phase === 'error') return state.chunks.length || Number.MAX_SAFE_INTEGER
  let count = 0
  while (count < state.chunks.length && state.chunks[count].status !== 'pending') count++
  return count
}

/** True when the audio for `index` exists and can be played (as opposed to merely settled). */
export function playableUrl(state: NarrationState, index: number): string | null {
  const chunk = state.chunks[index]
  return chunk && chunk.status === 'ready' ? chunk.url : null
}
