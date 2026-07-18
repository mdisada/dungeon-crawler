import { describe, expect, it } from 'vitest'

import { parseRegenEntity } from './regen-entity.ts'

describe('parseRegenEntity', () => {
  it('parses each entity type into snake_case row fields', () => {
    expect(
      parseRegenEntity('chapter', '{ "title": "The Third Bell", "arc_summary": "Countdown in the chapel." }'),
    ).toEqual({ ok: true, data: { title: 'The Third Bell', arc_summary: 'Countdown in the chapel.' } })

    const npc = parseRegenEntity(
      'npc',
      JSON.stringify({
        name: 'Mother Brine',
        role: 'boss',
        personality: { traits: 'gentle' },
        faction: '',
        description: 'Grief-priest.',
        image_prompt: 'robed woman with bell',
      }),
    )
    expect(npc.ok).toBe(true)

    const location = parseRegenEntity(
      'location',
      '{ "name": "Sunken Chapel", "description": "Drowned nave.", "image_prompt": "underwater chapel" }',
    )
    expect(location.ok).toBe(true)
  })

  it('enforces objective title length and predicate validity', () => {
    const bad = parseRegenEntity(
      'objective',
      JSON.stringify({
        title: 'Find out everything about the sunken chapel bells',
        hidden_description: 'x',
        completion_predicates: { maybe: true },
      }),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes('over 6 words'))).toBe(true)
      expect(bad.errors.some((e) => e.includes('completion_predicates'))).toBe(true)
    }

    const good = parseRegenEntity(
      'objective',
      JSON.stringify({
        title: 'Silence the third bell',
        hidden_description: 'The finale.',
        completion_predicates: { flag: 'third_bell_silenced', eq: true },
      }),
    )
    expect(good.ok).toBe(true)
  })

  it('parses an ending with closed-vocabulary signals and maps refs to UUIDs', () => {
    const refs = {
      objectives: [{ id: 'obj-uuid-1', label: 'Silence the third bell' }],
      npcs: [{ id: 'npc-uuid-1', label: 'Mother Brine (boss)' }],
      dials: [{ key: 'mercy', name: 'Mercy' }],
    }
    const ending = {
      title: 'Grief Answered',
      description: 'Brine drowns the bell herself.',
      climax_summary: 'A held breath in the chapel.',
      tone: 'bittersweet',
      trigger_conditions: {
        summary: 'Empathic play.',
        signals: [{ when: { npc: 1, state: 'allied' }, weight: 4, note: 'trust unlocks it' }],
      },
    }
    const result = parseRegenEntity('ending', JSON.stringify(ending), refs)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const stored = result.data.trigger_conditions as { signals: { when: unknown }[] }
      expect(stored.signals[0].when).toEqual({ npc_id: 'npc-uuid-1', state: 'allied' })
    }

    const bad = JSON.parse(JSON.stringify(ending)) as typeof ending
    bad.trigger_conditions.signals[0].when = { objective: 99, outcome: 'completed' } as never
    bad.trigger_conditions.signals[0].weight = 99
    const badResult = parseRegenEntity('ending', JSON.stringify(bad), refs)
    expect(badResult.ok).toBe(false)
    if (!badResult.ok) {
      expect(badResult.errors.some((e) => e.includes('objective number'))).toBe(true)
      expect(badResult.errors.some((e) => e.includes('[-5, 5]'))).toBe(true)
    }
  })

  it('fails ending regen without ref lists', () => {
    const result = parseRegenEntity('ending', '{}')
    expect(result.ok).toBe(false)
  })
})
