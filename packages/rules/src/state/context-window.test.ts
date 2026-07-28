import { describe, expect, it } from 'vitest'

import {
  agentContextLines, agentContextSplit, liveLines, MAX_DIGESTS, nextDigests,
} from './context-window.ts'
import type { GameState } from './types.ts'

const line = (id: string, text: string, speaker: string | null = null) => ({ id, speaker, npcId: null, text })

const stateWith = (
  lines: { id: string; speaker: string | null; npcId: null; text: string }[],
  window?: { digests: string[]; sinceLineId: string | null },
) => ({
  dialogue: { lines },
  dm: window ? { contextWindow: window } : {},
} as unknown as GameState)

describe('agentContextLines (phase-exit compaction)', () => {
  const lines = [
    line('a', 'the inn burns'),
    line('b', 'we flee', 'Bram'),
    line('c', 'the road is dark'),
    line('d', 'what now', 'Bram'),
  ]

  it('sends the raw tail when nothing has been compacted yet', () => {
    expect(agentContextLines(stateWith(lines), 2)).toEqual([
      'Narrator: the road is dark',
      'Bram: what now',
    ])
  })

  it('replaces closed phases with their digest and keeps only the live tail', () => {
    const state = stateWith(lines, { digests: ['The inn burned down; the party fled.'], sinceLineId: 'c' })
    expect(agentContextLines(state, 10)).toEqual([
      'Earlier: The inn burned down; the party fled.',
      'Narrator: the road is dark',
      'Bram: what now',
    ])
  })

  it('keeps the whole history when the boundary line has aged out of the bounded history', () => {
    const state = stateWith(lines, { digests: [], sinceLineId: 'long-gone' })
    expect(liveLines(state)).toHaveLength(lines.length)
  })

  it('caps the digest list so the window cannot grow without bound', () => {
    let digests: string[] = []
    for (let i = 0; i < MAX_DIGESTS + 4; i++) digests = nextDigests(digests, `phase ${i}`)
    expect(digests).toHaveLength(MAX_DIGESTS)
    expect(digests.at(-1)).toBe(`phase ${MAX_DIGESTS + 3}`)
  })

  it('advances the boundary without recording an empty digest', () => {
    expect(nextDigests(['kept'], '   ')).toEqual(['kept'])
  })

  it('splits the two halves for callers that label them separately', () => {
    const state = stateWith(lines, { digests: ['The inn burned down.'], sinceLineId: 'c' })
    expect(agentContextSplit(state, 10)).toEqual({
      digests: ['The inn burned down.'],
      recent: ['Narrator: the road is dark', 'Bram: what now'],
    })
  })

  it('splits into the same content the joined form produces', () => {
    const state = stateWith(lines, { digests: ['one', 'two'], sinceLineId: 'c' })
    const { digests, recent } = agentContextSplit(state, 10)
    expect([...digests.map((d) => `Earlier: ${d}`), ...recent]).toEqual(agentContextLines(state, 10))
  })

  it('reports no digests before the first phase closes', () => {
    expect(agentContextSplit(stateWith(lines), 2).digests).toEqual([])
  })
})
