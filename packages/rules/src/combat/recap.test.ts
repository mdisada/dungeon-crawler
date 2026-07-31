import { describe, expect, it } from 'vitest'

import { recapLine, recapLines } from './recap.ts'
import type { RecapContext } from './recap.ts'
import type { CombatEvent } from './types.ts'

const NAMES: Record<string, string> = { p1: 'Bram', e1: 'Dredger' }
const ctx: RecapContext = { name: (id) => NAMES[id] ?? id, isParty: (id) => id.startsWith('p') }

const hp = (current: number, max: number) => ({ current, max, temp: 0 })

describe('recapLines', () => {
  it('gives the party exact numbers and the enemy a band', () => {
    const events = [
      { kind: 'damage', id: 'p1', amount: 7, hp: hp(13, 30) },
      { kind: 'damage', id: 'e1', amount: 9, hp: hp(4, 20) },
    ] as CombatEvent[]
    expect(recapLines(events, ctx)).toEqual([
      'Bram takes 7 damage (13/30).',
      'Dredger takes a hit (near death).',
    ])
  })

  it('never prints the target AC or the roll behind an attack', () => {
    const attack = {
      kind: 'attack', attackerId: 'p1', targetId: 'e1', attackName: 'Longsword', reaction: false,
      roll: { dice: [18], used: 18, mods: [{ label: 'to hit', value: 5 }], total: 23, advantage: 'none' },
      targetAc: 12, outcome: 'hit', damage: { rolls: [6], sides: 8, bonus: 3, mult: 1, total: 9 },
    } as unknown as CombatEvent
    const line = recapLine(attack, ctx)
    expect(line).toBe('Bram hits Dredger with Longsword.')
    expect(line).not.toMatch(/12|23|AC/)
  })

  it('drops the bookkeeping events that would only add noise at the table', () => {
    const noise = [
      { kind: 'combat_start', difficulty: 'Standard' },
      { kind: 'turn_start', id: 'p1', name: 'Bram' },
      { kind: 'turn_end', id: 'p1' },
      { kind: 'initiative', order: [] },
    ] as unknown as CombatEvent[]
    expect(recapLines(noise, ctx)).toEqual([])
  })

  it('keeps the beats the table has to see', () => {
    const events = [
      { kind: 'round_start', round: 2 },
      { kind: 'down', id: 'e1', name: 'Dredger', result: 'dead' },
      { kind: 'combat_end', winner: 'party' },
    ] as unknown as CombatEvent[]
    expect(recapLines(events, ctx)).toEqual([
      '-- Round 2 --',
      'Dredger falls, dead.',
      'The last of them goes down. The field is yours.',
    ])
  })
})
