import { describe, expect, it } from 'vitest'

import {
  actionAutoAllowed, canConsumeOpening, cappedSceneDelta, clampDisposition, clampDispositionDelta,
  dispositionBand, effectiveDispositionDelta, filterLocationReveals, locationRevealVerdict,
  openingDcMod, revealVerdict, SCENE_DISPOSITION_DRIFT_MAX, filterReveals,
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

describe('location reveal gate (searching a scene finds what is authored there)', () => {
  const atScene: RevealCandidate = {
    id: 'ing-1', npcId: null, locationId: 'loc-1', condition: null,
    discovered: false, boundCharacterId: null, anyPc: true,
  }
  const ctx = { locationId: 'loc-1', actorCharacterId: 'pc-a', checkPassed: true }

  it('allows an undiscovered clue placed in the current scene on a successful attempt', () => {
    expect(locationRevealVerdict(atScene, ctx)).toEqual({ allowed: true })
  })

  it('refuses everything it should', () => {
    const deny = (candidate: Partial<RevealCandidate>, override = {}) =>
      locationRevealVerdict({ ...atScene, ...candidate }, { ...ctx, ...override })
    expect(deny({ discovered: true }).allowed).toBe(false)
    expect(deny({ locationId: null }).allowed).toBe(false)
    expect(deny({}, { locationId: 'loc-2' }).allowed).toBe(false)
    expect(deny({}, { locationId: null }).allowed).toBe(false)
    // A failed search finds nothing - the check IS the entitlement.
    expect(deny({}, { checkPassed: false }).allowed).toBe(false)
    expect(deny({ anyPc: false, boundCharacterId: 'pc-b' }).allowed).toBe(false)
    expect(deny({ anyPc: false, boundCharacterId: 'pc-a' }).allowed).toBe(true)
  })

  // Live 2026-07-20: stage 4 placed 15 of 35 clues on an NPC *and* at a location. Refusing
  // those made searching the room they sit in useless.
  it('still finds a clue that is also placed on an NPC', () => {
    expect(locationRevealVerdict({ ...atScene, npcId: 'npc-1' }, ctx)).toEqual({ allowed: true })
  })

  it('filterLocationReveals splits the batch and explains each refusal', () => {
    const { allowed, blocked } = filterLocationReveals(
      [atScene, { ...atScene, id: 'ing-2', locationId: 'loc-2' }, { ...atScene, id: 'ing-3', discovered: true }],
      ctx,
    )
    expect(allowed).toEqual(['ing-1'])
    expect(blocked.map((b) => b.id)).toEqual(['ing-2', 'ing-3'])
  })
})

describe('disposition damping (talk alone is not a relationship)', () => {
  const nothing = { checkResolved: false, revealed: false, proposedAction: false }

  it('zeroes plain conversation and keeps concrete outcomes', () => {
    expect(effectiveDispositionDelta(1, nothing)).toBe(0)
    expect(effectiveDispositionDelta(-2, nothing)).toBe(0)
    expect(effectiveDispositionDelta(1, { ...nothing, checkResolved: true })).toBe(1)
    expect(effectiveDispositionDelta(1, { ...nothing, revealed: true })).toBe(1)
    expect(effectiveDispositionDelta(1, { ...nothing, proposedAction: true })).toBe(1)
    expect(effectiveDispositionDelta(9, { ...nothing, revealed: true })).toBe(2)
  })

  it('caps per-scene drift in the direction already spent, but allows correction back', () => {
    expect(cappedSceneDelta(2, 0)).toBe(2)
    expect(cappedSceneDelta(2, SCENE_DISPOSITION_DRIFT_MAX - 1)).toBe(1)
    expect(cappedSceneDelta(2, SCENE_DISPOSITION_DRIFT_MAX)).toBe(0)
    expect(cappedSceneDelta(-2, SCENE_DISPOSITION_DRIFT_MAX)).toBe(-2)
    expect(cappedSceneDelta(-2, -SCENE_DISPOSITION_DRIFT_MAX)).toBe(0)
  })
})
