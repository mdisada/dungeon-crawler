import { describe, expect, it } from 'vitest'

import { deflectDirective, deflectLevel } from './deflect'

const at = (turnsOffSpine: number, priorDeflections = 0, threshold = 3) =>
  deflectLevel({ turnsOffSpine, threshold, priorDeflections })

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

  it('stays at shut rather than inventing a fourth rung', () => {
    expect(at(12, 3)).toBe('shut')
    expect(at(12, 40)).toBe('shut')
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
