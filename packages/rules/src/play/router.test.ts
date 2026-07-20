import { describe, expect, it } from 'vitest'

import { classifyIntent } from './router.ts'

const noNpcs = { mode: 'narration', stagedNpcIds: [] }
const staged = { mode: 'roleplay', stagedNpcIds: ['npc-1'] }

describe('classifyIntent (deterministic - the fast path never reaches an LLM)', () => {
  it('routes move and combat verbs to the fast path', () => {
    for (const kind of ['move', 'attack', 'cast', 'use_item'] as const) {
      expect(classifyIntent({ kind, skill: null, targetId: null }, staged)).toBe('fast_path')
    }
  })

  it('routes explicit-skill rolls to the fast path, bare rolls to the Adjudicator', () => {
    expect(classifyIntent({ kind: 'roll', skill: 'athletics', targetId: null }, noNpcs)).toBe('fast_path')
    expect(classifyIntent({ kind: 'roll', skill: null, targetId: null }, noNpcs)).toBe('adjudicate')
  })

  it('routes say to dialogue when an NPC is staged or targeted', () => {
    expect(classifyIntent({ kind: 'say', skill: null, targetId: null }, staged)).toBe('dialogue')
    expect(classifyIntent({ kind: 'say', skill: null, targetId: 'npc-9' }, noNpcs)).toBe('dialogue')
  })

  it('routes say with no NPC in scene to the Adjudicator - the DM answers, not silence', () => {
    expect(classifyIntent({ kind: 'say', skill: null, targetId: null }, noNpcs)).toBe('adjudicate')
    expect(classifyIntent({ kind: 'say', skill: null, targetId: null }, { mode: 'downtime', stagedNpcIds: [] })).toBe('adjudicate')
  })

  it('keeps say as free table chat mid-encounter (battle/puzzle)', () => {
    expect(classifyIntent({ kind: 'say', skill: null, targetId: null }, { mode: 'battle', stagedNpcIds: [] })).toBe('chat')
    expect(classifyIntent({ kind: 'say', skill: null, targetId: null }, { mode: 'puzzle', stagedNpcIds: [] })).toBe('chat')
  })

  it('routes free-text do to the Adjudicator and dm_command to the command handler', () => {
    expect(classifyIntent({ kind: 'do', skill: null, targetId: null }, staged)).toBe('adjudicate')
    expect(classifyIntent({ kind: 'dm_command', skill: null, targetId: null }, staged)).toBe('dm_command')
  })
})
