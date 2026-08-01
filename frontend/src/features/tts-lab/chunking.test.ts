import { describe, expect, it } from 'vitest'

import { buildChunking, settledBoxes } from './chunking'

const SCRIPT = 'The stair ends in water. Not a flood, a still black sheet. Your torch goes into it.'

describe('buildChunking', () => {
  it('makes one synthesis unit per box in the shipped mode', () => {
    const { boxes, units, unitsFor } = buildChunking(SCRIPT, 240, 'box')

    expect(boxes).toHaveLength(1)
    expect(units).toEqual(boxes)
    expect(unitsFor).toEqual([[0]])
  })

  it('makes one unit per sentence, mapped back to the box that plays them', () => {
    const { boxes, units, unitsFor } = buildChunking(SCRIPT, 240, 'sentence')

    expect(boxes).toHaveLength(1)
    expect(units).toHaveLength(3)
    expect(unitsFor).toEqual([[0, 1, 2]])
  })

  it('keeps box and unit indices aligned across several boxes', () => {
    const { boxes, unitsFor } = buildChunking(SCRIPT, 40, 'sentence')

    expect(boxes.length).toBeGreaterThan(1)
    // Every unit index appears exactly once, in order, across the whole mapping.
    expect(unitsFor.flat()).toEqual(unitsFor.flat().map((_, index) => index))
  })
})

describe('settledBoxes', () => {
  it('opens a box only once every clip it plays has settled', () => {
    const unitsFor = [[0, 1, 2], [3], [4, 5]]

    expect(settledBoxes(unitsFor, 0)).toBe(0)
    // Two of box 0's three sentences are ready - not enough to show it.
    expect(settledBoxes(unitsFor, 2)).toBe(0)
    expect(settledBoxes(unitsFor, 3)).toBe(1)
    expect(settledBoxes(unitsFor, 4)).toBe(2)
    expect(settledBoxes(unitsFor, 6)).toBe(3)
  })

  it('is the identity on box-per-unit chunking', () => {
    const unitsFor = [[0], [1], [2]]

    expect(settledBoxes(unitsFor, 0)).toBe(0)
    expect(settledBoxes(unitsFor, 2)).toBe(2)
    expect(settledBoxes(unitsFor, 3)).toBe(3)
  })
})
