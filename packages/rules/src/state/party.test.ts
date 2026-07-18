import { describe, expect, it } from 'vitest'

import { computePartyProfile } from './party.ts'
import type { PartyCharacter } from './party.ts'

function pc(over: Partial<PartyCharacter>): PartyCharacter {
  return {
    id: 'c1', name: 'Ash', classKey: 'fighter', level: 1,
    skillProficiencies: [], toolProficiencies: [],
    ...over,
  }
}

describe('computePartyProfile', () => {
  it('unions skills/tools sorted and dedupes classes', () => {
    const profile = computePartyProfile([
      pc({ id: 'a', skillProficiencies: ['stealth', 'persuasion'], toolProficiencies: ['thieves-tools'] }),
      pc({ id: 'b', classKey: 'fighter', skillProficiencies: ['athletics', 'stealth'] }),
    ])
    expect(profile.size).toBe(2)
    expect(profile.skills).toEqual(['athletics', 'persuasion', 'stealth'])
    expect(profile.tools).toEqual(['thieves-tools'])
    expect(profile.classes).toEqual(['fighter'])
  })

  it('scores pillars from class chassis and skill coverage', () => {
    const social = computePartyProfile([
      pc({ skillProficiencies: ['persuasion', 'deception', 'insight'] }),
    ])
    expect(social.pillarStrengths.social).toBe(1)
    expect(social.pillarStrengths.combat).toBe(1)

    const noSocial = computePartyProfile([pc({ classKey: null, skillProficiencies: [] })])
    expect(noSocial.pillarStrengths.social).toBe(0)
    expect(noSocial.pillarStrengths.combat).toBe(0)
  })

  it('recomputes deterministically on membership change (late joiner)', () => {
    const base = [pc({ id: 'a', skillProficiencies: ['athletics'] })]
    const before = computePartyProfile(base)
    const after = computePartyProfile([...base, pc({ id: 'b', classKey: 'bard', skillProficiencies: ['persuasion', 'performance', 'insight'] })])
    expect(before.size).toBe(1)
    expect(after.size).toBe(2)
    expect(after.classes).toEqual(['bard', 'fighter'])
    expect(after.pillarStrengths.social).toBeGreaterThan(before.pillarStrengths.social)
    // Same input, same output - stored profile can be hash-compared.
    expect(computePartyProfile(base)).toEqual(before)
  })

  it('handles an empty party without dividing by zero', () => {
    const profile = computePartyProfile([])
    expect(profile.size).toBe(0)
    expect(profile.pillarStrengths).toEqual({ combat: 0, social: 0, exploration: 0 })
  })

  it('leaves backstoryTags empty (LLM Hook Weaver pass is Phase 6)', () => {
    expect(computePartyProfile([pc({})]).backstoryTags).toEqual([])
  })
})
