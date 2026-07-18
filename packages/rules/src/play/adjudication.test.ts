import { describe, expect, it } from 'vitest'

import {
  extractJson, parseAdjudication, parseConsistency, parseNarrationOptions,
  parseNpcOutput, parseSocialClassification,
} from './adjudication.ts'
import { DC_MAX, DC_MIN } from './checks.ts'

const PARTY_SKILLS = ['athletics', 'persuasion', 'stealth']

describe('extractJson', () => {
  it('parses plain and fenced JSON, and salvages embedded objects', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! Here you go: {"a":1} hope that helps')).toEqual({ a: 1 })
    expect(extractJson('no json at all')).toBeNull()
  })
})

describe('parseAdjudication', () => {
  const valid = {
    interpretation: 'Kaelen vaults the fence',
    resolution: {
      type: 'check',
      check: { skill: 'Athletics', dc: 14, adv_dis: 'none', rationale: 'wet planks' },
      consequences_hint: 'lands in the yard or falls loudly',
    },
    flags: {},
  }

  it('accepts a valid check spec and lowercases the skill', () => {
    const out = parseAdjudication(valid, PARTY_SKILLS)
    if (!out.ok) throw new Error(out.errors.join())
    expect(out.data.resolution.check?.skill).toBe('athletics')
    expect(out.data.resolution.check?.dc).toBe(14)
  })

  it('clamps out-of-bounds DCs server-side regardless of model output', () => {
    const low = parseAdjudication(
      { ...valid, resolution: { ...valid.resolution, check: { ...valid.resolution.check, dc: 2 } } },
      PARTY_SKILLS,
    )
    const high = parseAdjudication(
      { ...valid, resolution: { ...valid.resolution, check: { ...valid.resolution.check, dc: 99 } } },
      PARTY_SKILLS,
    )
    if (!low.ok || !high.ok) throw new Error('expected ok')
    expect(low.data.resolution.check?.dc).toBe(DC_MIN)
    expect(high.data.resolution.check?.dc).toBe(DC_MAX)
  })

  it('drops an assist spec whose skill nobody in the party has (composition guard)', () => {
    const withAssist = (skill: string) =>
      parseAdjudication(
        {
          ...valid,
          resolution: {
            ...valid.resolution,
            check: { ...valid.resolution.check, requires_assist: { skill, effect: 'enable' } },
          },
        },
        PARTY_SKILLS,
      )
    const present = withAssist('Stealth')
    const absent = withAssist('arcana')
    if (!present.ok || !absent.ok) throw new Error('expected ok')
    expect(present.data.resolution.check?.requiresAssist).toEqual({ skill: 'stealth', effect: 'enable' })
    expect(absent.data.resolution.check?.requiresAssist).toBeNull()
  })

  it('rejects malformed output instead of guessing', () => {
    expect(parseAdjudication(null, PARTY_SKILLS).ok).toBe(false)
    expect(parseAdjudication({ resolution: { type: 'banana' } }, PARTY_SKILLS).ok).toBe(false)
    expect(parseAdjudication({ resolution: { type: 'check' } }, PARTY_SKILLS).ok).toBe(false)
  })

  it('auto resolutions pass through with flags', () => {
    const out = parseAdjudication(
      { interpretation: 'x', resolution: { type: 'auto_fail', consequences_hint: 'no' }, flags: { impossible: true } },
      PARTY_SKILLS,
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.data.resolution.type).toBe('auto_fail')
    expect(out.data.flags.impossible).toBe(true)
  })
})

describe('parseSocialClassification', () => {
  it('degrades malformed output to plain conversation (no roll-for-everything)', () => {
    expect(parseSocialClassification(null)).toEqual({ kind: 'conversation' })
    expect(parseSocialClassification({ kind: 'influence', skill: 'fireball', magnitude: 'huge' })).toEqual({
      kind: 'influence', skill: 'persuasion', magnitude: 'reasonable',
    })
    expect(parseSocialClassification({ kind: 'insight' })).toEqual({ kind: 'insight', skill: 'insight' })
  })
})

describe('parseNpcOutput', () => {
  const pcs = ['pc-a', 'pc-b']

  it('clamps disposition deltas and validates address_pc/opening against real PCs', () => {
    const out = parseNpcOutput(
      {
        dialogue: 'I know nothing.',
        tone: 'evasive',
        address_pc: 'pc-b',
        reveals: ['ing-1', 7, 'ing-2'],
        opening: { unlocked_by: 'pc-a', skill: 'Persuasion' },
        disposition_delta: { value: -7, reason: 'insulted' },
      },
      pcs,
    )
    if (!out.ok) throw new Error(out.errors.join())
    expect(out.data.dispositionDelta.value).toBe(-2)
    expect(out.data.addressPc).toBe('pc-b')
    expect(out.data.reveals).toEqual(['ing-1', 'ing-2'])
    expect(out.data.opening).toEqual({ unlockedBy: 'pc-a', skill: 'persuasion' })
  })

  it('nulls address_pc/opening pointing at unknown PCs and rejects missing dialogue', () => {
    const out = parseNpcOutput(
      { dialogue: 'hm', address_pc: 'ghost', opening: { unlocked_by: 'ghost', skill: 'persuasion' } },
      pcs,
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.data.addressPc).toBeNull()
    expect(out.data.opening).toBeNull()
    expect(parseNpcOutput({ tone: 'silent' }, pcs).ok).toBe(false)
  })

  it('keeps only known proposed-action types', () => {
    const out = parseNpcOutput(
      {
        dialogue: 'Fine.',
        proposed_actions: [
          { type: 'give_item', payload: { item: 'ledger' } },
          { type: 'explode' },
          { type: 'leave' },
        ],
      },
      pcs,
    )
    if (!out.ok) throw new Error('expected ok')
    expect(out.data.proposedActions).toEqual([{ type: 'give_item', item: 'ledger' }, { type: 'leave' }])
  })
})

describe('parseConsistency', () => {
  it('any listed violation fails the draft even if ok=true', () => {
    expect(parseConsistency({ ok: true, violations: [] }).ok).toBe(true)
    expect(
      parseConsistency({ ok: true, violations: [{ claim: 'Joren speaks', conflicts_with: 'Joren died in session 2' }] }).ok,
    ).toBe(false)
    expect(parseConsistency('garbage').ok).toBe(true)
  })
})

describe('parseNarrationOptions', () => {
  it('accepts string or {summary} entries, capped at 4', () => {
    expect(parseNarrationOptions({ options: ['a', { summary: 'b' }, 'c', 'd', 'e'] })).toEqual(['a', 'b', 'c', 'd'])
    expect(parseNarrationOptions({})).toEqual([])
  })
})
