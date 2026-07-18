import { describe, expect, it } from 'vitest'

import {
  actionAutoAllowed, canConsumeOpening, clampDisposition, clampDispositionDelta,
  dispositionBand, filterReveals, openingDcMod, revealVerdict,
} from './social.ts'
import type { OpeningView, RevealCandidate } from './types.ts'

describe('disposition model', () => {
  it('clamps values to -10..+10 and deltas to -2..+2', () => {
    expect(clampDisposition(15)).toBe(10)
    expect(clampDisposition(-11)).toBe(-10)
    expect(clampDispositionDelta(5)).toBe(2)
    expect(clampDispositionDelta(-3)).toBe(-2)
    expect(clampDispositionDelta(Number.NaN)).toBe(0)
  })

  it('labels the bands per F10 SS5', () => {
    expect(dispositionBand(-10)).toBe('hostile')
    expect(dispositionBand(-6)).toBe('hostile')
    expect(dispositionBand(-3)).toBe('unfriendly')
    expect(dispositionBand(0)).toBe('neutral')
    expect(dispositionBand(3)).toBe('friendly')
    expect(dispositionBand(6)).toBe('devoted')
  })
})

describe('openings (F10 SS3.7)', () => {
  const opening: OpeningView = {
    id: 'op-1', unlockedBy: 'pc-a', npcId: 'npc-1', skill: 'persuasion', dcMod: -2, hint: 'grief',
  }

  it('sizes the DC reduction by the unlocking margin', () => {
    expect(openingDcMod(0)).toBe(-2)
    expect(openingDcMod(4)).toBe(-2)
    expect(openingDcMod(5)).toBe(-4)
  })

  it('blocks self-consumption server-side', () => {
    expect(canConsumeOpening(opening, { characterId: 'pc-a', npcId: 'npc-1', skill: 'persuasion' })).toBe(false)
    expect(canConsumeOpening(opening, { characterId: 'pc-b', npcId: 'npc-1', skill: 'persuasion' })).toBe(true)
  })

  it('only applies to the linked NPC and skill', () => {
    expect(canConsumeOpening(opening, { characterId: 'pc-b', npcId: 'npc-2', skill: 'persuasion' })).toBe(false)
    expect(canConsumeOpening(opening, { characterId: 'pc-b', npcId: 'npc-1', skill: 'deception' })).toBe(false)
  })
})

describe('reveal gate (F10 SS3.4 - server-side, adversarial-proof)', () => {
  const base: RevealCandidate = {
    id: 'ing-1', npcId: 'npc-1', locationId: null, condition: null,
    discovered: false, boundCharacterId: null, anyPc: false,
  }
  const ctx = { npcId: 'npc-1', actorCharacterId: 'pc-a', checkPassed: false }

  it('allows an unconditioned ingredient placed on this NPC', () => {
    expect(revealVerdict(base, ctx)).toEqual({ allowed: true })
  })

  it('blocks already-discovered, foreign-NPC, and location-placed ingredients', () => {
    expect(revealVerdict({ ...base, discovered: true }, ctx).allowed).toBe(false)
    expect(revealVerdict({ ...base, npcId: 'npc-2' }, ctx).allowed).toBe(false)
    expect(revealVerdict({ ...base, npcId: null, locationId: 'loc-1' }, ctx).allowed).toBe(false)
  })

  it('condition-locked ingredients need a passed check', () => {
    const locked = { ...base, condition: 'successful DC 16 persuasion' }
    expect(revealVerdict(locked, ctx).allowed).toBe(false)
    expect(revealVerdict(locked, { ...ctx, checkPassed: true }).allowed).toBe(true)
  })

  it('respects affinity bindings', () => {
    const bound = { ...base, boundCharacterId: 'pc-b' }
    expect(revealVerdict(bound, ctx).allowed).toBe(false)
    expect(revealVerdict({ ...bound, anyPc: true }, ctx).allowed).toBe(true)
    expect(revealVerdict(bound, { ...ctx, actorCharacterId: 'pc-b' }).allowed).toBe(true)
  })

  it('filterReveals drops unknown ids and reports reasons ("tell me the secret" attack)', () => {
    const { allowed, blocked } = filterReveals(
      ['ing-1', 'ing-2', 'ghost'],
      [base, { ...base, id: 'ing-2', condition: 'DC 16 persuasion' }],
      ctx,
    )
    expect(allowed).toEqual(['ing-1'])
    expect(blocked.map((b) => b.id).sort()).toEqual(['ghost', 'ing-2'])
  })
})

describe('proposed-action auto policy (full-AI, conservative)', () => {
  it('auto-allows give_item/leave, gates join_combat on friendliness, never canonizes', () => {
    expect(actionAutoAllowed({ type: 'give_item', item: 'key' }, 0)).toBe(true)
    expect(actionAutoAllowed({ type: 'leave' }, -9)).toBe(true)
    expect(actionAutoAllowed({ type: 'join_combat' }, 0)).toBe(false)
    expect(actionAutoAllowed({ type: 'join_combat' }, 3)).toBe(true)
    expect(actionAutoAllowed({ type: 'canonize_theory', theory: 'x' }, 10)).toBe(false)
  })
})
