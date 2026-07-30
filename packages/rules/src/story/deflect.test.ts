import { describe, expect, it } from 'vitest'

import { deflectDirective, deflectLevel } from './deflect'

const at = (turnsOffSpine: number, priorDeflections = 0, threshold = 3) =>
  deflectLevel({ turnsOffSpine, threshold, priorDeflections })

const holding = (turnsOffSpine: number, priorDeflections: number, threshold = 3) =>
  deflectLevel({ turnsOffSpine, threshold, priorDeflections, holdsRoute: true })

describe('deflectLevel', () => {
  it('leaves conversation alone inside the allowance', () => {
    expect(at(0)).toBe('none')
    expect(at(2)).toBe('none')
    expect(at(2, 5)).toBe('none') // prior brush-offs never bypass the allowance
  })

  it('escalates on brush-offs DELIVERED, not turns elapsed', () => {
    expect(at(3, 0)).toBe('soft')
    expect(at(3, 1)).toBe('firm')
    expect(at(3, 2)).toBe('shut')
  })

  it('always opens gently, however late the party finally speaks', () => {
    // The live failure: the counter advances whether or not anyone is talking, so keying the rung
    // to it opened on 'firm' and never once said 'soft' (2026-07-27).
    expect(at(4)).toBe('soft')
    expect(at(40)).toBe('soft')
  })

  it('says shut ONCE, then settles back to firm', () => {
    // Was 'shut' forever: every deflection from the third onward returned it, for as long as the
    // stretch lasted - and the stretch can only end when the spine moves, which shut prevents.
    // Live e87b3506: five consecutive turns of an NPC saying almost nothing.
    expect(at(12, 2)).toBe('shut')
    expect(at(12, 3)).toBe('firm')
    expect(at(12, 40)).toBe('firm')
  })

  it('never hardens past soft against an NPC who holds the way forward', () => {
    // Rule 2: if canon says this person carries the clue, the affordance to talk to them stays.
    for (const prior of [1, 2, 3, 9]) expect(holding(7, prior)).toBe('soft')
  })

  it('still respects the allowance for a route-holding NPC', () => {
    // holdsRoute softens the ESCALATION; it does not start deflecting early.
    expect(holding(2, 4)).toBe('none')
  })

  it('regression e87b3506: seven turns of good questions must not shut the clue-holder', () => {
    // The party asked about the vial, the graves, Voss's instruction and the seal, learned the real
    // plot from the answers, and every turn was fold_in - so the counter climbed to 7 uncredited
    // while a reveal sat gated behind a persuasion check with this same NPC.
    const levels = [3, 4, 5, 6, 7].map((t, i) => holding(t, i + 1))
    expect(levels).toEqual(['soft', 'soft', 'soft', 'soft', 'soft'])
    // Same stretch, an NPC holding nothing: the ladder still does its job.
    expect([3, 4, 5, 6, 7].map((t, i) => at(t, i + 1)))
      .toEqual(['firm', 'shut', 'firm', 'firm', 'firm'])
  })

  it('tracks the difficulty threshold', () => {
    expect(at(3, 0, 6)).toBe('none')
    expect(at(6, 0, 6)).toBe('soft')
  })

  it('never divides by a zero or negative allowance', () => {
    expect(at(0, 0, 0)).toBe('none')
    expect(at(1, 0, 0)).toBe('soft')
    expect(at(0, 0, -5)).toBe('none')
  })
})

describe('deflectDirective', () => {
  it('says nothing at all below the threshold', () => {
    expect(deflectDirective('none', 'Recover the ledger')).toBe('')
  })

  it('names the actual goal so the NPC steers somewhere specific', () => {
    for (const level of ['soft', 'firm', 'shut'] as const) {
      expect(deflectDirective(level, 'Recover the ledger')).toContain('Recover the ledger')
    }
  })

  it('survives an objective with no title', () => {
    expect(deflectDirective('soft', '   ')).toContain('what actually needs doing')
    expect(deflectDirective('soft', '   ')).not.toContain('undefined')
  })

  it('directs behaviour, never the words - the voice stays the NPC\'s', () => {
    // The one property that matters: no canned player-facing line anywhere in the directive.
    for (const level of ['soft', 'firm', 'shut'] as const) {
      const d = deflectDirective(level, 'Find the boy')
      expect(d).toMatch(/your (own )?(manner|voice)|in character/)
    }
  })

  it('gets firmer as it climbs', () => {
    expect(deflectDirective('soft', 'g')).toContain('passing word')
    expect(deflectDirective('firm', 'g')).toContain('Decline the tangent outright')
    expect(deflectDirective('shut', 'g')).toContain('Say almost nothing')
  })
})
