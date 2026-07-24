import { describe, expect, it } from 'vitest'

import {
  ENCOUNTER_TEMPLATES, pickTemplate, templateByKey, templateGuidance, templateMenu,
  templatesForKind, TWIST_AXES,
} from './templates-encounter'

describe('the library', () => {
  it('has unique keys and every template carries at least one twist axis', () => {
    const keys = ENCOUNTER_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const t of ENCOUNTER_TEMPLATES) {
      expect(t.twists.length, t.key).toBeGreaterThan(0)
      for (const twist of t.twists) expect(TWIST_AXES).toContain(twist)
      expect(t.shape.length, t.key).toBeGreaterThan(10)
    }
  })
  it('covers every playable kind with real choice (anti-generic)', () => {
    for (const kind of ['skill_challenge', 'social', 'puzzle'] as const) {
      expect(templatesForKind(kind).length, kind).toBeGreaterThanOrEqual(3)
    }
  })
  it('templateByKey round-trips and rejects invention', () => {
    expect(templateByKey('chase')?.kind).toBe('skill_challenge')
    expect(templateByKey('a_shape_the_model_made_up')).toBeNull()
  })
})

describe('templateMenu (anti-repeat)', () => {
  it('drops recently used shapes', () => {
    const menu = templateMenu('skill_challenge', ['chase', 'ritual'])
    expect(menu).not.toContain('chase')
    expect(menu).not.toContain('ritual')
    expect(menu.length).toBeGreaterThan(0)
  })
  it('never returns empty - a repeat beats no template at all', () => {
    const all = templatesForKind('social').map((t) => t.key)
    expect(templateMenu('social', all)).toEqual(all)
  })
  it('is empty only for kinds with no templates', () => {
    expect(templateMenu('combat').length).toBeGreaterThan(0)
  })
})

describe('pickTemplate', () => {
  it('is stable per seed and spreads across seeds', () => {
    expect(pickTemplate('skill_challenge', 'obj-a')?.key).toBe(pickTemplate('skill_challenge', 'obj-a')?.key)
    const picked = new Set(
      Array.from({ length: 12 }, (_, i) => pickTemplate('skill_challenge', `obj-${i}`)?.key),
    )
    expect(picked.size).toBeGreaterThan(1)
  })
  it('only ever returns a template of the requested kind', () => {
    for (let i = 0; i < 12; i++) {
      expect(pickTemplate('social', `s-${i}`)?.kind).toBe('social')
    }
  })
})

describe('templateGuidance', () => {
  it('names the shape and spells out the twist', () => {
    const template = templateByKey('infiltration')!
    const guidance = templateGuidance(template, 'timer')
    expect(guidance).toContain(template.shape)
    expect(guidance).toContain('timer')
    expect(guidance.length).toBeGreaterThan(40)
  })
})
