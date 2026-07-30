import { describe, expect, it } from 'vitest'

import { mechanicalVocab, trailingLabel } from './mechanical-vocab'

describe('mechanicalVocab', () => {
  it('catches the real leaks', () => {
    expect(mechanicalVocab('The failure clings to you like the foundry dust')).toBe('The failure')
    expect(mechanicalVocab('The first setback already cost you.')).toBe('setback')
    expect(mechanicalVocab('You will need a check for that.')).toBe('a check')
    expect(mechanicalVocab('The DC is beyond you.')).toBe('DC')
  })

  it('leaves good prose alone - the first draft of this list did not', () => {
    // Every one of these tripped the un-bounded version, or a term I have since removed.
    for (const line of [
      'The fog rolled in off the canal.',
      'A chance encounter with the harbourmaster.',
      'Her objective was clear enough.',
      'You fail to shift the block.',
      'The bell tolled, and the water rolled black beneath the pier.',
      'Three tiers of scaffolding lean over the dock.',
    ]) {
      expect(mechanicalVocab(line), line).toBeNull()
    }
  })

  it('is safe on empty input', () => {
    expect(mechanicalVocab('')).toBeNull()
  })
})

describe('trailingLabel', () => {
  const labels = ["Earn Netta Vasch's trust", 'Audit the Vasch Weighbridge']

  it('catches the machine goal pasted on as a closing sentence', () => {
    // Three narrations in run abd318e1 ended exactly like this.
    const text = 'You peer closer at the script, but its meaning stays elusive. Earn Netta Vasch\u2019s trust.'
    expect(trailingLabel(text, labels)).toBe("Earn Netta Vasch's trust")
  })

  it('allows a label described legitimately mid-prose', () => {
    const text = 'She wants your help to audit the Vasch Weighbridge, and she is not asking twice.'
    expect(trailingLabel(text, labels)).toBeNull()
  })

  it('ignores labels too short to be distinctive', () => {
    expect(trailingLabel('He waits by the door.', ['door'])).toBeNull()
  })

  it('is safe on empty input', () => {
    expect(trailingLabel('', labels)).toBeNull()
    expect(trailingLabel('Prose.', [])).toBeNull()
  })
})
