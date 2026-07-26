import { describe, expect, it } from 'vitest'

import { annotateNarration, buildGuideView, buildPlaythrough, explainEvent, narrationKey } from './index.ts'
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

  it('correlates each line to its Logs turn; NPC lines inherit the surrounding turn', () => {
    const lines = [
      { speaker: null, text: 'You stand in Oakhaven.' },
      { speaker: 'Bram', text: 'I head to the chapel.' },
      { speaker: null, text: 'The chapel doors groan inward.' },
      { speaker: 'Old Man Hemlock', text: 'Welcome, traveler.' }, // npc reply — no text anchor
    ]
    const anchors = [
      { turnIndex: 0, text: narrationKey('You stand in Oakhaven.') },
      { turnIndex: 1, text: narrationKey('I head to the chapel.') },
      { turnIndex: 1, text: narrationKey('The chapel doors groan inward.') },
    ]
    expect(annotateNarration(lines, anchors).map((l) => l.turnIndex)).toEqual([0, 1, 1, 1])
  })
})

describe('buildGuideView', () => {
  const view = buildGuideView({
    chapters: [{ index: 0, title: 'Ch1', status: 'active' }],
    objectives: [
      { index: 1, title: 'Find the killer', reveal_state: 'completed' },
      { index: 0, title: 'Investigate', reveal_state: 'completed' },
      { index: 2, title: 'Confront', reveal_state: 'hidden' },
    ],
    npcs: [
      { id: 'n1', name: 'Elara', role: 'npc', initial_state: 'alive' },
      { id: 'n2', name: 'The Maw', role: 'boss', initial_state: 'alive' },
    ],
    locations: [{ id: 'l1', name: 'Bazaar' }, { id: 'l2', name: 'Archives' }],
    encounters: [{ type: 'battle', spec: { label: 'Ambush' } }],
    endings: [
      { index: 1, title: 'Pyrrhic', tone: 'grim', status: 'candidate' },
      { index: 0, title: 'Triumph', tone: 'bright', status: 'leading' },
    ],
    ingredients: [
      { type: 'clue', reveals: 'the ledger is fake', content: null, discovered: true },
      { type: 'secret', reveals: 'the mayor lied', content: null, discovered: false },
      { type: 'item', reveals: 'a sword', content: null, discovered: false },
    ],
    npcStates: { n2: 'dead' },
    currentLocationId: 'l2',
  })

  it('orders objectives and overlays their live reveal state', () => {
    expect(view.objectives.map((o) => o.title)).toEqual(['Investigate', 'Find the killer', 'Confront'])
    expect(view.objectives[2].state).toBe('hidden')
    expect(view.counts).toMatchObject({ objectivesDone: 2, objectivesTotal: 3 })
  })

  it('overlays live NPC state, current location, and clue discovery', () => {
    expect(view.npcs.find((npc) => npc.name === 'The Maw')?.state).toBe('dead')
    expect(view.npcs.find((npc) => npc.name === 'Elara')?.state).toBe('alive')
    expect(view.locations.find((l) => l.name === 'Archives')?.current).toBe(true)
    // Only info toys (clue/secret) are clues, not the item; discovery overlaid.
    expect(view.clues.map((c) => c.text)).toEqual(['the ledger is fake', 'the mayor lied'])
    expect(view.counts).toMatchObject({ cluesFound: 1, cluesTotal: 2 })
  })

  it('sorts endings by index and keeps the leading one', () => {
    expect(view.endings[0]).toMatchObject({ title: 'Triumph', status: 'leading' })
    expect(view.encounters[0]).toEqual({ kind: 'battle', label: 'Ambush' })
  })
})
