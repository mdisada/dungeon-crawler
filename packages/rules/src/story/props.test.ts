import { describe, expect, it } from 'vitest'

import { corpsePropText, scenePropsAt } from './props'
import type { PropRow } from './props'

const corpse = (id: string, name: string, locationId: string | null): PropRow => ({
  id,
  content: { text: corpsePropText(name), prop: 'corpse', npc_id: `npc-${id}` },
  placement: locationId ? { location_id: locationId } : {},
})

describe('scenePropsAt', () => {
  it('returns props sitting where the party stands', () => {
    const rows = [corpse('1', "Valerius's Agents", 'loc-a')]
    expect(scenePropsAt(rows, 'loc-a')).toEqual([
      { id: '1', text: "The body of Valerius's Agents", prop: 'corpse' },
    ])
  })

  it('hides a body the party has walked away from', () => {
    expect(scenePropsAt([corpse('1', 'Elias', 'loc-a')], 'loc-b')).toEqual([])
  })

  it('an unplaced prop is world-wide', () => {
    expect(scenePropsAt([corpse('1', 'Elias', null)], 'anywhere')).toHaveLength(1)
    expect(scenePropsAt([corpse('1', 'Elias', null)], null)).toHaveLength(1)
  })

  it('IGNORES authored items - loot is not scene dressing', () => {
    // The whole treasure table would otherwise land in every narration prompt.
    const authoredItem: PropRow = {
      id: 'i1',
      content: { text: 'a silver locket' }, // no `prop` marker
      placement: { location_id: 'loc-a' },
    }
    expect(scenePropsAt([authoredItem], 'loc-a')).toEqual([])
  })

  it('tolerates malformed rows instead of throwing into a narration', () => {
    const junk: PropRow[] = [
      { id: 'a', content: null, placement: null },
      { id: 'b', content: 'prose', placement: [] },
      { id: 'c', content: { prop: 'corpse' }, placement: {} }, // no text
      { id: 'd', content: { prop: '', text: 'x' }, placement: {} }, // empty marker
      { id: 'e', content: { prop: 'corpse', text: '   ' }, placement: {} }, // blank text
    ]
    expect(scenePropsAt(junk, 'loc-a')).toEqual([])
  })

  it('lists several bodies from one fight, in row order', () => {
    const rows = [corpse('1', 'First Agent', 'loc-a'), corpse('2', 'Second Agent', 'loc-a')]
    expect(scenePropsAt(rows, 'loc-a').map((p) => p.text)).toEqual([
      'The body of First Agent', 'The body of Second Agent',
    ])
  })
})

describe('corpsePropText', () => {
  it('names the body deterministically - code owns identity, narrator owns description', () => {
    expect(corpsePropText('Elias Thorne')).toBe('The body of Elias Thorne')
  })
})
