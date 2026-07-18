import { describe, expect, it } from 'vitest'

import { applyDiff, applyDiffs, mergePatch } from './diff.ts'
import { hashState, stableStringify } from './hash.ts'
import { initialGameState } from './types.ts'
import type { GameState, Json, StateDiff } from './types.ts'

describe('mergePatch', () => {
  it('merges nested objects recursively', () => {
    const out = mergePatch({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } })
    expect(out).toEqual({ a: { b: 9, c: 2 }, d: 3 })
  })

  it('replaces arrays wholesale', () => {
    expect(mergePatch({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] })
  })

  it('null deletes keys', () => {
    expect(mergePatch({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 })
  })

  it('scalar patch replaces the target', () => {
    expect(mergePatch({ a: 1 }, 'text')).toBe('text')
  })
})

describe('applyDiff', () => {
  it('updates a single domain and leaves the rest untouched by reference', () => {
    const state = initialGameState()
    const next = applyDiff(state, { domain: 'scene', patch: { mode: 'roleplay' } })
    expect(next.scene.mode).toBe('roleplay')
    expect(next.scene.day).toBe(1)
    expect(next.dialogue).toBe(state.dialogue)
    expect(state.scene.mode).toBe('narration')
  })

  it('null patch clears nullable domains (combat end)', () => {
    let state = initialGameState()
    state = applyDiff(state, {
      domain: 'combat',
      patch: {
        locationId: null, mapUrl: null, obstacles: [], tokens: [], initiative: [],
        round: 1, activeTokenId: 't1', economy: { action: true, bonus: true, move: 6, reaction: true },
      },
    })
    expect(state.combat?.round).toBe(1)
    state = applyDiff(state, { domain: 'combat', patch: null })
    expect(state.combat).toBeNull()
  })

  it('dm domain can be stripped with a null patch (player-side state)', () => {
    const state = applyDiff(initialGameState(), { domain: 'dm', patch: null })
    expect(state.dm).toBeNull()
  })
})

describe('mode transitions from scripted diff sequences', () => {
  const transition = (mode: string, visual: string): StateDiff => ({
    domain: 'scene',
    patch: { mode, activeVisual: visual } as Json,
  })

  it('narration -> roleplay -> battle -> narration reproduces the expected modes', () => {
    const seq = [
      transition('narration', 'background'),
      transition('roleplay', 'background'),
      transition('battle', 'map'),
      transition('narration', 'background'),
    ]
    let state: GameState = initialGameState()
    const seen: string[] = []
    for (const diff of seq) {
      state = applyDiff(state, diff)
      seen.push(`${state.scene.mode}/${state.scene.activeVisual}`)
    }
    expect(seen).toEqual(['narration/background', 'roleplay/background', 'battle/map', 'narration/background'])
  })

  it('two clients applying the same diffs converge to the same hash', () => {
    const diffs: StateDiff[] = [
      { domain: 'scene', patch: { mode: 'battle', activeVisual: 'map' } },
      { domain: 'players', patch: { list: [{ userId: 'u1', characterId: 'c1', name: 'Ash', connected: true, hp: { current: 5, max: 9, temp: 0 }, conditions: [] }] } as Json },
    ]
    const a = applyDiffs(initialGameState(), diffs)
    const b = applyDiffs(initialGameState(), diffs)
    expect(hashState(a as unknown as Json)).toBe(hashState(b as unknown as Json))
  })
})

describe('stable hash', () => {
  it('is insensitive to key order at any depth', () => {
    const x: Json = { a: 1, nested: { p: [1, 2], q: 'z' } }
    const y: Json = { nested: { q: 'z', p: [1, 2] }, a: 1 }
    expect(stableStringify(x)).toBe(stableStringify(y))
    expect(hashState(x)).toBe(hashState(y))
  })

  it('differs when values differ', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }))
  })
})
