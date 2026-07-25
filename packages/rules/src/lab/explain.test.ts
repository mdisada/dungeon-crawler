import { describe, expect, it } from 'vitest'

import { annotateNarration, buildPlaythrough, explainEvent } from './index.ts'
import type { ExplainContext, PlayEvent } from './index.ts'

const ctx: ExplainContext = {
  npcs: { 'npc-1': 'Sgt Valerius' },
  objectives: {},
  locations: {},
  ingredients: { 'ing-1': 'the ledger is forged' },
  characters: { 'pc-1': 'Bram' },
}
const ev = (id: number, type: string, payload: Record<string, unknown> = {}): PlayEvent => ({
  id, type, payload, created_at: '2026-07-25T00:00:00Z',
})

describe('explainEvent', () => {
  it('renders the reply pipeline in plain English', () => {
    expect(explainEvent(ev(1, 'check_rolled', { skill: 'deception', total: 18, dc: 13, success: true }), ctx)?.text)
      .toBe('deception check: rolled 18 vs DC 13 → SUCCESS')
    const reply = explainEvent(ev(2, 'npc_reply', { npc_id: 'npc-1', tone: 'wary', revealed: ['ing-1'] }), ctx)
    expect(reply?.text).toContain('Sgt Valerius replies')
    expect(reply?.text).toContain('the ledger is forged')
    expect(reply?.severity).toBe('good')
  })

  it('flags real problems as issues', () => {
    expect(explainEvent(ev(3, 'scene_effect_rejected', { effect: 'travel', proposed: 'The Archives' }), ctx)?.severity).toBe('issue')
    expect(explainEvent(ev(4, 'incident', { kind: 'npc_state_unverified', name: 'Elara' }), ctx)?.severity).toBe('issue')
    expect(explainEvent(ev(5, 'agent_output_unparsed', { role: 'npc_agent', finish_reason: 'length', chars: 13989 }), ctx)?.severity).toBe('issue')
    // A dropped non-travel scene effect is routine, not a bug.
    expect(explainEvent(ev(6, 'scene_effect_rejected', { effect: 'stage_npcs', reason: 'non-social' }), ctx)?.severity).toBe('info')
  })

  it('skips plumbing but renders unknown types generically (never drops them)', () => {
    expect(explainEvent(ev(7, 'scene_ledger', {}), ctx)).toBeNull()
    expect(explainEvent(ev(8, 'a_brand_new_event', {}), ctx)?.text).toBe('a brand new event')
  })
})

describe('buildPlaythrough', () => {
  const events: PlayEvent[] = [
    ev(1, 'session_started', { index: 1 }),
    ev(2, 'narration_published', { text: 'You stand in Oakhaven.' }),
    ev(3, 'intent_submitted', { text: 'I examine the altar', route: 'dialogue' }),
    ev(4, 'check_rolled', { skill: 'investigation', total: 20, dc: 13, success: true }),
    ev(5, 'intent_submitted', { text: 'I head to the chapel', route: 'entry' }),
    ev(6, 'narration_published', { text: 'The chapel doors groan inward, revealing a nave.' }),
    ev(7, 'narration_published', { text: 'The chapel doors groan inward, revealing a nave.' }),
    ev(8, 'scene_effect_rejected', { effect: 'travel', proposed: 'The Archives' }),
  ]
  const pt = buildPlaythrough(events, ctx)

  it('groups into a setup card + one card per player action', () => {
    expect(pt.turns.map((t) => t.player)).toEqual([null, 'I examine the altar', 'I head to the chapel'])
    expect(pt.turns[0].label).toBe('Setup & session start')
    expect(pt.turns[1].label).toBe('Turn 1')
  })

  it('collects the travel dead-end and the duplicate narration as issues', () => {
    const texts = pt.issues.map((i) => i.text)
    expect(texts.some((t) => t.includes('Could not travel'))).toBe(true)
    expect(texts.some((t) => t.includes('Duplicate narration'))).toBe(true)
  })

  it('keeps every raw event for the toggle', () => {
    expect(pt.turns.reduce((sum, t) => sum + t.raw.length, 0)).toBe(events.length)
  })
})

describe('annotateNarration', () => {
  it('flags mechanical fallback and duplicate lines, leaves clean prose alone', () => {
    const out = annotateNarration([
      { speaker: null, text: 'You enter the crumbling chapel.' },
      { speaker: 'Bram', text: 'I light a torch.' },
      { speaker: null, text: 'The attempt is resolved; the outcome stands.' },
      { speaker: null, text: 'The chapel doors groan inward.' },
      { speaker: null, text: 'The chapel doors groan inward.' },
    ])
    expect(out.map((l) => l.flag)).toEqual([null, null, 'fallback', null, 'duplicate'])
    expect(out[0].speaker).toBeNull()
    expect(out[1].speaker).toBe('Bram')
  })
})
