import { describe, expect, it } from 'vitest'

import {
  initialNarrationState,
  narrationReducer,
  playableUrl,
  settledCount,
} from './narration-state'
import type { NarrationAction, NarrationState } from './narration-state'

function apply(state: NarrationState, ...actions: NarrationAction[]): NarrationState {
  return actions.reduce(narrationReducer, state)
}

function started(count: number): NarrationState {
  return narrationReducer(initialNarrationState, { type: 'start', lineId: 'line-1', count })
}

const ready = (index: number): NarrationAction => ({
  type: 'ready',
  index,
  url: `https://audio/${index}`,
  atMs: 100 * index,
  serverMs: 900,
})

describe('settledCount', () => {
  it('is a prefix, so a chunk arriving early advances nothing', () => {
    const state = apply(started(4), ready(2), ready(3))
    expect(settledCount(state)).toBe(0)
  })

  it('advances past every chunk the out-of-order arrivals already filled in', () => {
    const state = apply(started(4), ready(2), ready(3), ready(0), ready(1))
    expect(settledCount(state)).toBe(4)
  })

  it('counts a failure and a timeout as settled - a dead chunk must not hold the story', () => {
    const state = apply(
      started(3),
      ready(0),
      { type: 'failed', index: 1, error: 'Fish 500', atMs: 200 },
      { type: 'timeout', index: 2, atMs: 8_000 },
    )
    expect(settledCount(state)).toBe(3)
  })

  it('settles everything at once when no voice is assigned', () => {
    const state = apply(started(3), { type: 'silent' })
    expect(settledCount(state)).toBe(3)
  })

  it('settles everything at once when the request itself failed', () => {
    const state = apply(started(3), { type: 'error', message: 'network down' })
    expect(settledCount(state)).toBe(3)
  })
})

describe('settling is one-way', () => {
  it('discards audio that arrives after the deadline released the chunk', () => {
    const timedOut = apply(started(2), { type: 'timeout', index: 0, atMs: 8_000 })
    const late = narrationReducer(timedOut, ready(0))

    expect(late.chunks[0].status).toBe('timeout')
    expect(playableUrl(late, 0)).toBeNull()
  })

  it('keeps the first outcome when a broadcast is delivered twice', () => {
    const once = apply(started(2), ready(0))
    const twice = narrationReducer(once, {
      type: 'ready',
      index: 0,
      url: 'https://audio/other',
      atMs: 5_000,
      serverMs: 900,
    })

    expect(twice.chunks[0].url).toBe('https://audio/0')
    expect(twice.chunks[0].settledMs).toBe(0)
  })
})

describe('planned', () => {
  it('marks cache hits playable straight from the response and leaves misses pending', () => {
    const state = apply(started(3), {
      type: 'planned',
      atMs: 40,
      timings: { auth: 169, voice: 526, plan: 1168, total: 1169 },
      chunks: [
        { index: 0, url: 'https://audio/cached-0' },
        { index: 1, url: null },
        { index: 2, url: 'https://audio/cached-2' },
      ],
    })

    expect(state.phase).toBe('active')
    expect(state.serverTimings).toEqual({ auth: 169, voice: 526, plan: 1168, total: 1169 })
    expect(state.chunks[0].cached).toBe(true)
    expect(playableUrl(state, 1)).toBeNull()
    // Still a prefix: chunk 2 being cached does not open the gate past the miss at 1.
    expect(settledCount(state)).toBe(1)
  })
})

describe('start', () => {
  it('resets a previous line rather than carrying its chunks over', () => {
    const first = apply(started(3), ready(0), ready(1))
    const second = narrationReducer(first, { type: 'start', lineId: 'line-2', count: 2 })

    expect(second.lineId).toBe('line-2')
    expect(second.chunks).toHaveLength(2)
    expect(settledCount(second)).toBe(0)
  })
})
