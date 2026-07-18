import { describe, expect, it } from 'vitest'

import { abilityModifier, deriveNpcStatBlock, NPC_CR_LADDER } from './npc-stats.ts'

describe('deriveNpcStatBlock', () => {
  it('derives a complete, self-consistent block from a full seed', () => {
    const block = deriveNpcStatBlock({ cr: '1', archetype: 'brute', skills: ['Athletics'], attack: 'Greataxe' })
    expect(block.archetype).toBe('brute')
    expect(block.cr).toBe('1')
    expect(block.hpMax).toBeGreaterThan(0)
    expect(block.ac).toBeGreaterThanOrEqual(10)
    expect(block.attack.name).toBe('Greataxe')
    // Skill modifier = governing-ability modifier + proficiency bonus.
    expect(block.skillModifiers.Athletics).toBe(
      abilityModifier(block.abilities.str) + block.proficiencyBonus,
    )
    // Attack to-hit = attack-ability modifier + proficiency bonus (brute attacks with STR).
    expect(block.attack.toHit).toBe(abilityModifier(block.abilities.str) + block.proficiencyBonus)
  })

  it('never throws and coerces unknown archetype/CR to role defaults', () => {
    const npc = deriveNpcStatBlock({ cr: 'banana', archetype: 'wizardly', skills: ['NotASkill'] }, 'npc')
    expect(npc.archetype).toBe('skirmisher')
    expect(npc.cr).toBe('1/4')
    // Bad skill dropped -> falls back to the archetype's default skills.
    expect(npc.skillProficiencies.length).toBeGreaterThan(0)

    const empty = deriveNpcStatBlock(null)
    expect(NPC_CR_LADDER).toContain(empty.cr)
  })

  it('floors bosses at CR 2 and scales primaries with CR', () => {
    const weakBoss = deriveNpcStatBlock({ cr: '0', archetype: 'brute' }, 'boss')
    expect(weakBoss.crValue).toBeGreaterThanOrEqual(2)

    const low = deriveNpcStatBlock({ cr: '1', archetype: 'brute' })
    const high = deriveNpcStatBlock({ cr: '5', archetype: 'brute' })
    expect(high.abilities.str).toBeGreaterThan(low.abilities.str)
    expect(high.hpMax).toBeGreaterThan(low.hpMax)
    expect(high.proficiencyBonus).toBe(3)
    expect(low.proficiencyBonus).toBe(2)
  })

  it('caps scaled abilities at 20 and omits +0 from damage', () => {
    const block = deriveNpcStatBlock({ cr: '5', archetype: 'brute' })
    expect(block.abilities.str).toBeLessThanOrEqual(20)

    const caster = deriveNpcStatBlock({ cr: '1/4', archetype: 'sniper' })
    // dex 16 -> +3, so damage carries a +3; ensure a 0-mod case has no trailing +0.
    const flat = deriveNpcStatBlock({ cr: '0', archetype: 'minion' })
    expect(flat.attack.damage.includes('+0')).toBe(false)
    expect(caster.attack.damage).toContain('+')
  })
})
