import { describe, expect, it } from 'vitest'

import { computeFieldDiff, decideRegenAction } from './regen.ts'

describe('regeneration preserves human edits (F04 SS7)', () => {
  it('overwrites untouched rows, proposes on human-edited rows', () => {
    expect(decideRegenAction(false)).toBe('overwrite')
    expect(decideRegenAction(true)).toBe('propose')
  })

  it('diffs only fields the proposal mentions, by value', () => {
    const current = {
      title: 'Deal with Mother Brine',
      hidden_description: 'MY EDITED VERSION',
      reveal_state: 'active',
    }
    const proposed = {
      title: 'Deal with Mother Brine',
      hidden_description: 'Regenerated description',
    }
    const diff = computeFieldDiff(current, proposed)
    expect(diff).toEqual([
      { field: 'hidden_description', before: 'MY EDITED VERSION', after: 'Regenerated description' },
    ])
  })

  it('treats structurally equal jsonb as unchanged and missing-vs-null as equal', () => {
    const predicate = { any: [{ flag: 'x', eq: true }] }
    expect(
      computeFieldDiff(
        { completion_predicates: { any: [{ flag: 'x', eq: true }] }, pending: undefined },
        { completion_predicates: predicate, pending: null },
      ),
    ).toEqual([])
  })
})
