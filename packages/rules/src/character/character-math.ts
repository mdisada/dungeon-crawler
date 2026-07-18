// Standard 5e proficiency-bonus-by-level formula (same in the 2014 and 2024 SRDs); matches the
// table for levels 1-20 (+2 at 1-4, +3 at 5-8, ... +6 at 17-20).
export function proficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1
}

const HIT_DIE_SIZE: Record<string, number> = {
  D6: 6,
  D8: 8,
  D10: 10,
  D12: 12,
}

// v1 (F02): level-1 characters only. Max hit die result + Constitution modifier.
export function hitPointsMaxAtLevelOne(hitDice: string, conModifier: number): number {
  const dieSize = HIT_DIE_SIZE[hitDice.toUpperCase()]
  if (dieSize === undefined) throw new Error(`Unknown hit die: ${hitDice}`)
  return dieSize + conModifier
}

export interface ArmorClassInput {
  dexModifier: number
  armor?: {
    acBase: number
    addDexModifier: boolean
    dexModifierCap: number | null
  }
}

// No armor (v1 default, or unarmored): 10 + Dex modifier. With armor: base + (capped) Dex bonus,
// per the armor's own ac_add_dexmod / ac_cap_dexmod (srd_armor columns).
export function armorClass({ dexModifier, armor }: ArmorClassInput): number {
  if (!armor) return 10 + dexModifier
  if (!armor.addDexModifier) return armor.acBase
  const dexBonus = armor.dexModifierCap !== null ? Math.min(dexModifier, armor.dexModifierCap) : dexModifier
  return armor.acBase + dexBonus
}

export function savingThrowModifier(abilityModifier: number, isProficient: boolean, proficiencyBonusValue: number): number {
  return abilityModifier + (isProficient ? proficiencyBonusValue : 0)
}

export function skillModifier(abilityModifier: number, isProficient: boolean, proficiencyBonusValue: number): number {
  return abilityModifier + (isProficient ? proficiencyBonusValue : 0)
}
