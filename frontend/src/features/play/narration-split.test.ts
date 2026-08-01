import { describe, expect, it } from 'vitest'

import { splitNarration, settledBoxCount } from './sentences'

const SCRIPT = 'The stair ends in water. Not a flood, a still black sheet. Your torch goes into it.'

describe('splitNarration', () => {
  it('makes one synthesis unit per box in the shipped mode', () => {
    const { boxes, units, unitsFor } = splitNarration(SCRIPT, 240, 'box')

    expect(boxes).toHaveLength(1)
    expect(units).toEqual(boxes)
    expect(unitsFor).toEqual([[0]])
  })

  it('makes one unit per sentence, mapped back to the box that plays them', () => {
    const { boxes, units, unitsFor } = splitNarration(SCRIPT, 240, 'sentence')

    expect(boxes).toHaveLength(1)
    expect(units).toHaveLength(3)
    expect(unitsFor).toEqual([[0, 1, 2]])
  })

  it('keeps box and unit indices aligned across several boxes', () => {
    const { boxes, unitsFor } = splitNarration(SCRIPT, 40, 'sentence')

    expect(boxes.length).toBeGreaterThan(1)
    // Every unit index appears exactly once, in order, across the whole mapping.
    expect(unitsFor.flat()).toEqual(unitsFor.flat().map((_, index) => index))
  })

  it('splits only the first box under lead, which is the play default', () => {
    const { boxes, units, unitsFor } = splitNarration(SCRIPT, 40)

    expect(boxes.length).toBeGreaterThan(1)
    // Box 0 becomes its sentences so the story can start speaking on the first one...
    expect(unitsFor[0].length).toBeGreaterThan(0)
    // ...and every later box stays a single clip, keeping its prosody.
    for (const box of unitsFor.slice(1)) expect(box).toHaveLength(1)
    expect(units).toHaveLength(unitsFor.flat().length)
  })

  it('loses no text whichever way it splits', () => {
    for (const mode of ['box', 'sentence', 'lead'] as const) {
      const { units } = splitNarration(SCRIPT, 40, mode)
      expect(units.join(' ').replace(/\s+/g, ' ')).toBe(SCRIPT.replace(/\s+/g, ' '))
    }
  })
})

describe('settledBoxCount', () => {
  it('opens a box only once every clip it plays has settled', () => {
    const unitsFor = [[0, 1, 2], [3], [4, 5]]

    expect(settledBoxCount(unitsFor, 0)).toBe(0)
    // Two of box 0's three sentences are ready - not enough to show it.
    expect(settledBoxCount(unitsFor, 2)).toBe(0)
    expect(settledBoxCount(unitsFor, 3)).toBe(1)
    expect(settledBoxCount(unitsFor, 4)).toBe(2)
    expect(settledBoxCount(unitsFor, 6)).toBe(3)
  })

  it('is the identity on box-per-unit chunking', () => {
    const unitsFor = [[0], [1], [2]]

    expect(settledBoxCount(unitsFor, 0)).toBe(0)
    expect(settledBoxCount(unitsFor, 2)).toBe(2)
    expect(settledBoxCount(unitsFor, 3)).toBe(3)
  })
})
