import { describe, expect, it } from 'vitest'

import {
  canonicalizeAtomSlug, editDistance, isNearMiss, MAX_LOCAL_ATOMS_PER_BEAT, registerLocalAtoms,
  resolveAtomText, rewritePredicateAtoms, suggestAtomTexts,
} from './atoms'
import type { RegistryAtom } from './atoms'

describe('canonicalizeAtomSlug', () => {
  it('strips apostrophes instead of splitting on them', () => {
    expect(canonicalizeAtomSlug("ignored_scholar's_warning")).toBe('ignored_scholars_warning')
  })
  it('collapses spaces and punctuation to single underscores', () => {
    expect(canonicalizeAtomSlug('party entered the sunken crypt!')).toBe('party_entered_the_sunken_crypt')
    expect(canonicalizeAtomSlug('  Lantern--Relit ')).toBe('lantern_relit')
  })
  it('returns empty for punctuation-only input', () => {
    expect(canonicalizeAtomSlug('!!!')).toBe('')
  })
})

describe('resolveAtomText', () => {
  const authored = ['lantern_relit', 'keeper_freed', 'party entered the sunken crypt', 'lost_expedition_journal_found']

  it('exact match wins and preserves authored text', () => {
    expect(resolveAtomText('lantern_relit', authored)).toEqual({ ok: true, text: 'lantern_relit', via: 'exact' })
  })
  it('case-insensitive exact resolves to authored casing', () => {
    expect(resolveAtomText('Lantern_Relit', authored)).toMatchObject({ ok: true, text: 'lantern_relit' })
  })
  it('canonical repair: punctuation', () => {
    expect(resolveAtomText('Party entered the sunken crypt.', authored))
      .toMatchObject({ ok: true, text: 'party entered the sunken crypt', via: 'canonical' })
  })
  it('word reorder NEVER auto-merges (subject/object reversals flip meaning)', () => {
    const result = resolveAtomText('relit_lantern', authored)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.suggestions).toContain('lantern_relit')
  })
  it('small typos NEVER auto-merge (antonyms live at edit distance 1-2)', () => {
    expect(resolveAtomText('lantern_relitt', authored).ok).toBe(false)
    // The review's proof pair: distance 1 apart, opposite meanings.
    expect(resolveAtomText('guards_averted', ['guards_alerted']).ok).toBe(false)
    expect(resolveAtomText('door_unlocked', ['door_locked']).ok).toBe(false)
  })
  it('the live drift pair must NOT auto-merge', () => {
    const result = resolveAtomText('found_expedition_journal', authored)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.suggestions).toContain('lost_expedition_journal_found')
  })
})

describe('editDistance', () => {
  it('bails early past max', () => {
    expect(editDistance('abcdefgh', 'zyxwvuts', 2)).toBe(3)
    expect(editDistance('abc', 'abd', 2)).toBe(1)
  })
})

describe('isNearMiss', () => {
  it('identical strings are not a near-miss (that is canonical equality)', () => {
    expect(isNearMiss('a_b', 'a_b')).toBe(false)
  })
})

describe('suggestAtomTexts', () => {
  it('ranks by shared tokens', () => {
    const authored = ['lost_expedition_journal_found', 'keeper_freed', 'expedition_camp_reached']
    const suggestions = suggestAtomTexts('found_expedition_journal', authored)
    expect(suggestions[0]).toBe('lost_expedition_journal_found')
  })
})

describe('registerLocalAtoms', () => {
  const spine: RegistryAtom[] = [
    { slug: 'lost_expedition_journal_found', kind: 'flag', scope: 'spine', label: 'lost_expedition_journal_found' },
  ]

  it('creates locals with a canonical slug but the DECLARED name as label', () => {
    const result = registerLocalAtoms([{ name: "Scholar's Trust Won", kind: 'flag' }], spine)
    expect(result.created).toEqual([
      { slug: 'scholars_trust_won', kind: 'flag', scope: 'local', label: "Scholar's Trust Won" },
    ])
    // Identity mapping: the predicate keeps the declared spelling, so legacy exact matching
    // (shadow mode) still hits it - only REUSED declarations rewrite to an existing label.
    expect(result.mapping.get("Scholar's Trust Won")).toBe("Scholar's Trust Won")
  })
  it('reuses the spine atom on canonical collision', () => {
    const result = registerLocalAtoms([{ name: 'Lost Expedition Journal Found', kind: 'flag' }], spine)
    expect(result.created).toHaveLength(0)
    expect(result.reused[0].atom.slug).toBe('lost_expedition_journal_found')
    expect(result.mapping.get('Lost Expedition Journal Found')).toBe('lost_expedition_journal_found')
  })
  it('reorders and sequential neighbors CREATE distinct atoms (no fuzzy reuse)', () => {
    expect(registerLocalAtoms([{ name: 'journal_found_lost_expedition', kind: 'flag' }], spine).created).toHaveLength(1)
    // ward_2 is a genuinely NEW atom, not a typo of ward_1 (review's instant-exit scenario).
    const wards = registerLocalAtoms(
      [{ name: 'ward_2_broken', kind: 'flag' }],
      [{ slug: 'ward_1_broken', kind: 'flag', scope: 'local', label: 'ward_1_broken' }],
    )
    expect(wards.created).toHaveLength(1)
    expect(wards.reused).toHaveLength(0)
  })
  it('rejects a slug collision across kinds instead of fusing namespaces', () => {
    const result = registerLocalAtoms(
      [{ name: 'lost expedition journal found', kind: 'event' }],
      spine,
    )
    expect(result.reused).toHaveLength(0)
    expect(result.rejected[0].reason).toContain('collides')
  })
  it('dedupes within a proposal batch', () => {
    const result = registerLocalAtoms(
      [{ name: 'gate_opened', kind: 'flag' }, { name: 'Gate Opened!', kind: 'flag' }],
      [],
    )
    expect(result.created).toHaveLength(1)
  })
  it('caps at MAX_LOCAL_ATOMS_PER_BEAT', () => {
    const proposals = Array.from({ length: 6 }, (_, i) => ({ name: `atom_${i}`, kind: 'flag' as const }))
    const result = registerLocalAtoms(proposals, [])
    expect(result.created).toHaveLength(MAX_LOCAL_ATOMS_PER_BEAT)
    expect(result.rejected).toHaveLength(2)
  })
  it('rejects punctuation-only names', () => {
    const result = registerLocalAtoms([{ name: '???', kind: 'flag' }], [])
    expect(result.rejected[0].reason).toContain('empty')
  })
})

describe('rewritePredicateAtoms', () => {
  it('rewrites nested flag/event atoms through the mapping', () => {
    const mapping = new Map([["Scholar's Trust Won", 'scholars_trust_won']])
    const predicate = {
      any: [
        { flag: "Scholar's Trust Won", eq: true },
        { all: [{ event: 'untouched marker' }, { flag: 'other', eq: true }] },
      ],
    }
    expect(rewritePredicateAtoms(predicate, mapping)).toEqual({
      any: [
        { flag: 'scholars_trust_won', eq: true },
        { all: [{ event: 'untouched marker' }, { flag: 'other', eq: true }] },
      ],
    })
  })
})
