// Iconic SRD spells for the Combat Lab (F09 SS9): a browsable library the lab assigns to any
// combatant, and golden-test data. Save DCs/attack bonuses are baked in (editable in the lab)
// rather than derived per caster - the harness tests mechanics, not spellcasting-ability math.
// Ranges/areas are in squares (5 ft): Fireball's 20-ft radius = 4, Lightning Bolt's 100 ft = 20.

import type { SpellSpec } from './types.ts'

export const SPELL_LIBRARY: SpellSpec[] = [
  // Attack-roll cantrips/spells (roll vs AC).
  { name: 'Fire Bolt', cost: 'action', effect: 'attack', range: 24, toHit: 5, amount: { count: 1, sides: 10, bonus: 0 }, damageType: 'fire', area: { shape: 'single' } },
  { name: 'Ray of Frost', cost: 'action', effect: 'attack', range: 12, toHit: 5, amount: { count: 1, sides: 8, bonus: 0 }, damageType: 'cold', area: { shape: 'single' } },
  { name: 'Guiding Bolt', cost: 'action', effect: 'attack', range: 24, toHit: 5, amount: { count: 4, sides: 6, bonus: 0 }, damageType: 'radiant', area: { shape: 'single' } },
  { name: 'Chill Touch', cost: 'action', effect: 'attack', range: 24, toHit: 5, amount: { count: 1, sides: 8, bonus: 0 }, damageType: 'necrotic', area: { shape: 'single' } },
  // Save-based, single target.
  { name: 'Sacred Flame', cost: 'action', effect: 'save', range: 12, saveAbility: 'dex', saveDc: 14, onSave: 'none', amount: { count: 1, sides: 8, bonus: 0 }, damageType: 'radiant', area: { shape: 'single' } },
  { name: 'Inflict Wounds', cost: 'action', effect: 'attack', range: 1, toHit: 5, amount: { count: 3, sides: 10, bonus: 0 }, damageType: 'necrotic', area: { shape: 'single' } },
  // Save-based AoE (each creature in the template saves).
  { name: 'Fireball', cost: 'action', effect: 'save', range: 30, saveAbility: 'dex', saveDc: 15, onSave: 'half', amount: { count: 8, sides: 6, bonus: 0 }, damageType: 'fire', area: { shape: 'circle', radius: 4 } },
  { name: 'Burning Hands', cost: 'action', effect: 'save', range: 0, saveAbility: 'dex', saveDc: 14, onSave: 'half', amount: { count: 3, sides: 6, bonus: 0 }, damageType: 'fire', area: { shape: 'cone', length: 3 } },
  { name: 'Lightning Bolt', cost: 'action', effect: 'save', range: 0, saveAbility: 'dex', saveDc: 15, onSave: 'half', amount: { count: 8, sides: 6, bonus: 0 }, damageType: 'lightning', area: { shape: 'line', length: 20 } },
  { name: 'Thunderwave', cost: 'action', effect: 'save', range: 0, saveAbility: 'con', saveDc: 13, onSave: 'half', amount: { count: 2, sides: 8, bonus: 0 }, damageType: 'thunder', area: { shape: 'cube', size: 3 } },
  { name: 'Shatter', cost: 'action', effect: 'save', range: 12, saveAbility: 'con', saveDc: 14, onSave: 'half', amount: { count: 3, sides: 8, bonus: 0 }, damageType: 'thunder', area: { shape: 'circle', radius: 2 } },
  // Healing.
  { name: 'Cure Wounds', cost: 'action', effect: 'heal', range: 1, amount: { count: 1, sides: 8, bonus: 3 }, area: { shape: 'single' }, affects: 'allies' },
  { name: 'Healing Word', cost: 'bonus', effect: 'heal', range: 12, amount: { count: 1, sides: 4, bonus: 3 }, area: { shape: 'single' }, affects: 'allies' },
  { name: 'Mass Healing Word', cost: 'bonus', effect: 'heal', range: 12, amount: { count: 1, sides: 4, bonus: 3 }, area: { shape: 'circle', radius: 2 }, affects: 'allies' },
]

export function findSpell(name: string): SpellSpec | undefined {
  return SPELL_LIBRARY.find((s) => s.name === name)
}
