import { describe, expect, it } from 'vitest'

import { decideCanonization, parseGrounding, playerLines } from './canonization'
import type { PlayerLine } from './canonization'

const pcs = ['Bram', 'Kestrel']

describe('playerLines - the closed menu of what the party said', () => {
  const scene = [
    { speaker: 'Bram', npcId: null, text: 'I think the magistrate is being blackmailed.' },
    { speaker: 'Elara Vance', npcId: 'n1', text: 'You should not say that aloud.' },
    { speaker: null, npcId: null, text: 'The lantern gutters in the draught.' },
    { speaker: 'Kestrel', npcId: null, text: 'Who pays the guards, then?' },
  ]

  it('keeps only what party members said', () => {
    expect(playerLines(scene, pcs).map((l) => l.speaker)).toEqual(['Bram', 'Kestrel'])
  })

  it('excludes NPC dialogue even when the speaker name is a party name', () => {
    const impostor = [{ speaker: 'Bram', npcId: 'n9', text: 'not really Bram' }]
    expect(playerLines(impostor, pcs)).toEqual([])
  })

  it('excludes narration (no speaker)', () => {
    expect(playerLines(scene, pcs).some((l) => l.text.includes('lantern'))).toBe(false)
  })

  it('drops empty lines', () => {
    expect(playerLines([{ speaker: 'Bram', npcId: null, text: '   ' }], pcs)).toEqual([])
  })

  it('keeps the most recent and renumbers from zero', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ speaker: 'Bram', npcId: null, text: `line ${i}` }))
    const menu = playerLines(many, pcs, 3)
    expect(menu.map((l) => l.text)).toEqual(['line 9', 'line 10', 'line 11'])
    expect(menu.map((l) => l.index)).toEqual([0, 1, 2])
  })

  it('is empty when the party has said nothing', () => {
    expect(playerLines([{ speaker: 'Elara Vance', npcId: 'n1', text: 'hello' }], pcs)).toEqual([])
  })
})

describe('parseGrounding', () => {
  it('accepts a valid index', () => {
    expect(parseGrounding({ line_index: 1 }, 3)).toEqual({ lineIndex: 1 })
  })

  it('treats out-of-range, negative and non-integer as ungrounded', () => {
    expect(parseGrounding({ line_index: 3 }, 3).lineIndex).toBeNull()
    expect(parseGrounding({ line_index: -1 }, 3).lineIndex).toBeNull()
    expect(parseGrounding({ line_index: 1.5 }, 3).lineIndex).toBeNull()
  })

  it('accepts the bare scalar the model actually returns', () => {
    // Live 2026-07-23: asked for a single integer, the model replied `-1`, not an object.
    expect(parseGrounding(-1, 3).lineIndex).toBeNull()
    expect(parseGrounding(1, 3)).toEqual({ lineIndex: 1 })
    expect(parseGrounding(9, 3).lineIndex).toBeNull()
  })

  it('garbage in, ungrounded out', () => {
    expect(parseGrounding(null, 3).lineIndex).toBeNull()
    expect(parseGrounding('prose', 3).lineIndex).toBeNull()
    expect(parseGrounding({}, 3).lineIndex).toBeNull()
    expect(parseGrounding({ line_index: 'one' }, 3).lineIndex).toBeNull()
  })
})

describe('decideCanonization - refusal is the default', () => {
  const menu: PlayerLine[] = [
    { index: 0, speaker: 'Bram', text: 'I think the magistrate is being blackmailed.' },
  ]

  it('canonizes a theory a player actually asserted', () => {
    const decision = decideCanonization(menu, { lineIndex: 0 })
    expect(decision.canonize).toBe(true)
    expect(decision.source?.speaker).toBe('Bram')
  })

  it('THE live failure: refuses a theory no player ever said', () => {
    // 3 of 3 canonizations across every paid run were invented by the NPC Agent itself.
    expect(decideCanonization(menu, { lineIndex: null })).toEqual({
      canonize: false, reason: 'not_asserted', source: null,
    })
  })

  it('refuses when the party has not spoken at all', () => {
    expect(decideCanonization([], { lineIndex: 0 }).reason).toBe('no_player_lines')
  })

  it('refuses an index that is not in the menu', () => {
    expect(decideCanonization(menu, { lineIndex: 7 }).canonize).toBe(false)
  })
})
