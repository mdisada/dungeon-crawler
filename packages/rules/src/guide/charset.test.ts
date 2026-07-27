import { describe, expect, it } from 'vitest'

import { charsetError, foreignCharacters } from './charset'

describe('authored prose must be readable (2026-07-28)', () => {
  it('catches the live failure verbatim', () => {
    // Shipped in an ending's climax_summary, which is published to the player unaltered when the
    // live climax author fails.
    const text = "The party speaks Cris's death aloud at the lighthouse base - not the官方 story"
    expect(foreignCharacters(text)).toEqual(['官', '方'])
    expect(charsetError(text)).toContain('官')
  })

  it('leaves ordinary authored prose alone', () => {
    const fine = [
      "Mara Hakey's cottage is small and neat - filled with dried herbs.",
      'The keeper\u2019s granddaughter, Fen Tollen, insists nothing has changed\u2026',
      'A caf\u00e9 owner named Ysolde \u00d3 Braon\u00e1in runs the quay \u2014 she pays 50\u20ac a week.',
      'Tab\there\nand a newline.',
    ]
    for (const t of fine) {
      expect(foreignCharacters(t)).toEqual([])
      expect(charsetError(t)).toBeNull()
    }
  })

  it('reports each offending character once, in order', () => {
    expect(foreignCharacters('aДbДcЖ')).toEqual(['Д', 'Ж'])
  })

  it('catches other scripts and emoji, not just CJK', () => {
    for (const t of ['the Кремль gate', 'the مفتاح key', 'a torch 🔥 burns']) {
      expect(charsetError(t)).not.toBeNull()
    }
  })

  it('handles empty and nullish input without throwing', () => {
    expect(foreignCharacters('')).toEqual([])
    expect(charsetError('')).toBeNull()
  })
})
