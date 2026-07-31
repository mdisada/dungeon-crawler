import { describe, expect, it } from 'vitest'

import type { Bitmap } from './chroma-key'
import { autoFrameFromSilhouette, measureSilhouette, portraitRectFromToken } from './crop-geometry'

/**
 * A figure on transparency: 40px head from y=40, shoulders/torso 120px wide from y=100. `bow` adds
 * a thin diagonal prop that starts ABOVE the head and crosses the body - the case that broke the
 * first version of this, which measured each row's extent instead of its widest run.
 */
function figure({ armOut = false, bow = false } = {}): Bitmap {
  const width = 200
  const height = 400
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    data[i] = 180
    data[i + 1] = 140
    data[i + 2] = 120
    data[i + 3] = 255
  }

  for (let y = 40; y < 100; y++) for (let x = 80; x < 120; x++) paint(x, y)
  for (let y = 100; y < 360; y++) for (let x = 40; x < 160; x++) paint(x, y)
  if (armOut) for (let y = 150; y < 170; y++) for (let x = 160; x < 195; x++) paint(x, y)
  if (bow) for (let y = 10; y < 300; y++) for (let x = 20; x < 24; x++) paint(x, y)
  return { data, width, height }
}

describe('measureSilhouette', () => {
  it('finds the head and the shoulder line', () => {
    const s = measureSilhouette(figure())
    expect(s).not.toBeNull()
    expect(s?.headTop).toBe(40)
    expect(s?.headBottom).toBe(100)
    expect(s?.headWidth).toBe(40)
    expect(s?.headCentreX).toBeCloseTo(100, 0)
    expect(s?.bottom).toBe(359)
  })

  it('ignores a prop that starts above the head', () => {
    // The bow's 4px run is below the accessory threshold, so the head still starts at y=40 and its
    // width is still 40 - not the 100px extent from bow to skull.
    const s = measureSilhouette(figure({ bow: true }))
    expect(s?.headTop).toBe(40)
    expect(s?.headWidth).toBe(40)
    expect(s?.headCentreX).toBeCloseTo(100, 0)
  })

  it('centres on the head, not on an outstretched arm', () => {
    expect(measureSilhouette(figure({ armOut: true }))?.headCentreX).toBeCloseTo(100, 0)
  })

  it('returns null for an empty image', () => {
    const width = 20
    const height = 20
    expect(measureSilhouette({ data: new Uint8ClampedArray(width * height * 4), width, height })).toBeNull()
  })
})

describe('autoFrameFromSilhouette', () => {
  it('frames a square that contains the head with headroom', () => {
    const { token } = autoFrameFromSilhouette(figure())!
    expect(token.w).toBe(token.h)
    expect(token.w).toBeGreaterThan(40) // head plus margin
    expect(token.x).toBeLessThan(80)
    expect(token.x + token.w).toBeGreaterThan(120)
    expect(token.y).toBeLessThan(40) // headroom above the crown
    expect(token.y + token.h).toBeGreaterThan(100)
  })

  it('derives a 3:4 portrait that reaches down the torso', () => {
    const { portrait, token } = autoFrameFromSilhouette(figure())!
    expect(portrait.h / portrait.w).toBeCloseTo(1024 / 768, 2)
    expect(portrait.y).toBeLessThan(token.y + token.h)
    expect(portrait.y + portrait.h).toBeGreaterThan(200)
  })

  it('keeps every rect inside the image', () => {
    const image = figure({ bow: true, armOut: true })
    const { token, portrait } = autoFrameFromSilhouette(image)!
    for (const rect of [token, portrait]) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(image.width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(image.height)
    }
  })

  it('gives up on an image with no figure', () => {
    const width = 40
    const height = 40
    expect(autoFrameFromSilhouette({ data: new Uint8ClampedArray(width * height * 4), width, height })).toBeNull()
  })
})

describe('portraitRectFromToken', () => {
  it('is the derivation the manual crop tool uses', () => {
    const portrait = portraitRectFromToken({ x: 100, y: 100, w: 100, h: 100 }, 1024, 1024)
    expect(portrait.w).toBe(260)
    expect(portrait.h).toBeCloseTo(260 * (1024 / 768), 5)
    expect(portrait.x).toBe(20)
  })
})
