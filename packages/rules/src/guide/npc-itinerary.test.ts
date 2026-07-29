import { describe, expect, it } from 'vitest'

import { deriveNpcItineraries, npcLocationAt } from './npc-itinerary.ts'

const objectives = new Map([['o0', 0], ['o1', 1], ['o2', 2], ['o3', 3]])

describe('deriveNpcItineraries', () => {
  it('recovers a real journey from node placement alone', () => {
    // Guide 350c0363: Selka moves to the Spillstone for the climax ritual.
    const stops = deriveNpcItineraries([
      { objectiveId: 'o2', locationId: 'office', npcIds: ['selka'] },
      { objectiveId: 'o3', locationId: 'spillstone', npcIds: ['selka'] },
    ], objectives).get('selka')
    expect(stops).toEqual([
      { objectiveIndex: 2, locationId: 'office' },
      { objectiveIndex: 3, locationId: 'spillstone' },
    ])
  })

  it('collapses consecutive nodes in the same place into one stop', () => {
    const stops = deriveNpcItineraries([
      { objectiveId: 'o0', locationId: 'office', npcIds: ['edric'] },
      { objectiveId: 'o1', locationId: 'office', npcIds: ['edric'] },
    ], objectives).get('edric')
    expect(stops).toEqual([{ objectiveIndex: 0, locationId: 'office' }])
  })

  it('does NOT treat two routes of one objective as travel', () => {
    // Routes are alternatives - only one ever plays - so a character staged at the office by one
    // and the Spillstone by another is correct authoring, not a character in two places.
    const stops = deriveNpcItineraries([
      { objectiveId: 'o1', locationId: 'office', npcIds: ['selka'] },
      { objectiveId: 'o1', locationId: 'spillstone', npcIds: ['selka'] },
    ], objectives).get('selka')
    expect(stops).toEqual([{ objectiveIndex: 1, locationId: 'office' }])
  })

  it('places nobody from an unplaced node - a rescue happens wherever the party is', () => {
    const map = deriveNpcItineraries([
      { objectiveId: 'o0', locationId: null, npcIds: ['maren'] },
    ], objectives)
    expect(map.get('maren')).toBeUndefined()
  })
})

describe('npcLocationAt', () => {
  const stops = [
    { objectiveIndex: 2, locationId: 'office' },
    { objectiveIndex: 3, locationId: 'spillstone' },
  ]

  it('answers with the latest stop at or before the current objective', () => {
    expect(npcLocationAt(stops, 2)).toBe('office')
    expect(npcLocationAt(stops, 3)).toBe('spillstone')
    expect(npcLocationAt(stops, 9)).toBe('spillstone')
  })

  it('RETURNS NULL before the first stop rather than inventing one', () => {
    // Where Selka is during objectives 0-1 is genuinely unconstrained. A confident wrong answer
    // is worse than no answer.
    expect(npcLocationAt(stops, 0)).toBeNull()
    expect(npcLocationAt(stops, 1)).toBeNull()
  })
})
