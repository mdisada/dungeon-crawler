import { describe, expect, it } from 'vitest'

import { bindCoopSet, type PartyCharacter } from './affinity.ts'

// The acceptance-criteria fixtures (F04 SS7): the same split-knowledge set bound against a
// 3-PC party (distinct bindings) and a 1-PC party (graceful any_pc degradation).

const SET = [
  { ingredientId: 'ing-insight', revealsTo: { skill: 'insight' } },
  { ingredientId: 'ing-religion', revealsTo: { skill: 'religion' } },
  { ingredientId: 'ing-criminal', revealsTo: { background_tag: 'criminal' } },
]

const THREE_PC_PARTY: PartyCharacter[] = [
  { id: 'pc-cleric', className: 'Cleric', skills: ['religion', 'insight'], backgroundTags: ['acolyte'] },
  { id: 'pc-rogue', className: 'Rogue', skills: ['stealth', 'insight'], backgroundTags: ['criminal'] },
  { id: 'pc-bard', className: 'Bard', skills: ['persuasion', 'insight'], backgroundTags: ['entertainer'] },
]

const ONE_PC_PARTY: PartyCharacter[] = [
  { id: 'pc-cleric', className: 'Cleric', skills: ['religion', 'insight'], backgroundTags: ['acolyte'] },
]

describe('bindCoopSet', () => {
  it('binds every member to a DISTINCT character in a 3-PC party', () => {
    const bindings = bindCoopSet(SET, THREE_PC_PARTY)
    const bound = bindings.map((b) => b.boundTo)
    expect(bound).not.toContain('any_pc')
    expect(new Set(bound).size).toBe(3)
    // The criminal clue can only go to the rogue; religion then must avoid double-booking.
    expect(bindings.find((b) => b.ingredientId === 'ing-criminal')!.boundTo).toBe('pc-rogue')
    expect(bindings.find((b) => b.ingredientId === 'ing-religion')!.boundTo).toBe('pc-cleric')
    expect(bindings.find((b) => b.ingredientId === 'ing-insight')!.boundTo).toBe('pc-bard')
  })

  it('degrades unbindable members to any_pc in a 1-PC party without losing the set', () => {
    const bindings = bindCoopSet(SET, ONE_PC_PARTY)
    expect(bindings).toHaveLength(3)
    const boundIds = bindings.filter((b) => b.boundTo !== 'any_pc')
    expect(boundIds).toHaveLength(1)
    expect(boundIds[0].boundTo).toBe('pc-cleric')
  })

  it('reassigns via augmenting paths instead of greedy first-match', () => {
    // Member A matches only the cleric; member B matches cleric AND rogue. Greedy could stick
    // B on the cleric and strand A - the matching must recover.
    const bindings = bindCoopSet(
      [
        { ingredientId: 'a', revealsTo: { skill: 'religion' } },
        { ingredientId: 'b', revealsTo: { skill: 'insight' } },
      ],
      [
        { id: 'pc-cleric', className: 'Cleric', skills: ['religion', 'insight'], backgroundTags: [] },
        { id: 'pc-rogue', className: 'Rogue', skills: ['insight'], backgroundTags: [] },
      ],
    )
    expect(bindings.find((b) => b.ingredientId === 'a')!.boundTo).toBe('pc-cleric')
    expect(bindings.find((b) => b.ingredientId === 'b')!.boundTo).toBe('pc-rogue')
  })

  it('matches class and character_id affinities case-insensitively where sensible', () => {
    const party: PartyCharacter[] = [
      { id: 'pc-1', className: 'Rogue', skills: [], backgroundTags: [] },
    ]
    expect(bindCoopSet([{ ingredientId: 'x', revealsTo: { class: 'rogue' } }], party)[0].boundTo).toBe('pc-1')
    expect(bindCoopSet([{ ingredientId: 'x', revealsTo: { character_id: 'pc-1' } }], party)[0].boundTo).toBe('pc-1')
    expect(bindCoopSet([{ ingredientId: 'x', revealsTo: null }], party)[0].boundTo).toBe('any_pc')
  })
})
