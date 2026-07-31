import { describe, expect, it } from 'vitest'

import { isKeyableBackdrop, keyOutBackdrop, sampleBackdrop, type Bitmap } from './chroma-key'

const SCREEN: [number, number, number] = [46, 194, 46]

/**
 * A green field with a red square in it, and one column blended halfway between the two - the
 * antialiased edge a real generation has.
 */
function scene({ subject = [200, 60, 50] as [number, number, number], backdrop = SCREEN } = {}): Bitmap {
  const width = 40
  const height = 40
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inside = x >= 12 && x < 28 && y >= 12 && y < 28
      const onBlendColumn = x === 11 && y >= 12 && y < 28
      const colour = inside
        ? subject
        : onBlendColumn
          ? ([0, 1, 2].map((c) => Math.round((subject[c] + backdrop[c]) / 2)) as [number, number, number])
          : backdrop
      data[i] = colour[0]
      data[i + 1] = colour[1]
      data[i + 2] = colour[2]
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

const alphaAt = ({ data, width }: Bitmap, x: number, y: number) => data[(y * width + x) * 4 + 3]
const pixelAt = ({ data, width }: Bitmap, x: number, y: number) => [
  data[(y * width + x) * 4],
  data[(y * width + x) * 4 + 1],
  data[(y * width + x) * 4 + 2],
]

describe('chroma key', () => {
  it('reads the backdrop from the corners', () => {
    expect(sampleBackdrop(scene())).toEqual(SCREEN)
  })

  it('refuses backdrops that are not a green screen', () => {
    expect(isKeyableBackdrop(SCREEN)).toBe(true)
    expect(isKeyableBackdrop([18, 16, 17])).toBe(false) // the near-black backdrop we replaced
    expect(isKeyableBackdrop([120, 130, 125])).toBe(false) // a grey wall in an uploaded photo
  })

  it('leaves an unkeyable image untouched so the caller can fall back', () => {
    const image = scene({ backdrop: [18, 16, 17] })
    const before = Uint8ClampedArray.from(image.data)
    expect(keyOutBackdrop(image)).toBe(false)
    expect(image.data).toEqual(before)
  })

  it('makes the backdrop transparent and the subject opaque', () => {
    const image = scene()
    expect(keyOutBackdrop(image)).toBe(true)
    expect(alphaAt(image, 2, 2)).toBe(0)
    expect(alphaAt(image, 20, 20)).toBe(255)
  })

  it('gives the blended column a partial alpha instead of an in-or-out guess', () => {
    const image = scene()
    keyOutBackdrop(image)
    const edge = alphaAt(image, 11, 20)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })

  it('keeps the subject its own colour', () => {
    const image = scene()
    keyOutBackdrop(image)
    const [r, g, b] = pixelAt(image, 20, 20)
    expect(r).toBeGreaterThan(180)
    expect(g).toBeLessThan(90)
    expect(b).toBeLessThan(90)
  })

  it('does not drain an olive costume away from the edge', () => {
    // The colour the elf's cloak actually came back as. A global de-spill would grey it out.
    const image = scene({ subject: [90, 110, 60] })
    keyOutBackdrop(image)
    const [, green] = pixelAt(image, 20, 20)
    expect(alphaAt(image, 20, 20)).toBe(255)
    expect(green).toBeGreaterThan(100)
  })

  it('cuts out screen the figure encloses, not just screen around it', () => {
    // Deliberate: enclosed screen is normally a real gap - between a bow and its owner, or through a
    // tattered hem - and those must be transparent. The cost is that a screen-coloured *costume*
    // would be cut out too, which is why the prompt asks for no green in the costume. Keeping such
    // regions instead was tried on a real generation and filled the bow gap with raw green.
    const image = scene()
    for (let y = 16; y < 24; y++) {
      for (let x = 16; x < 24; x++) {
        const i = (y * image.width + x) * 4
        image.data[i] = SCREEN[0]
        image.data[i + 1] = SCREEN[1]
        image.data[i + 2] = SCREEN[2]
      }
    }
    keyOutBackdrop(image)
    expect(alphaAt(image, 20, 20)).toBe(0)
    expect(alphaAt(image, 14, 20)).toBe(255)
  })

  it('strips the screen colour out of the blended edge', () => {
    const image = scene()
    keyOutBackdrop(image)
    const [r, g, b] = pixelAt(image, 11, 20)
    // Before un-mixing this pixel is half screen green, so green dominates. After, it must not.
    expect(g).toBeLessThanOrEqual(Math.max(r, b))
  })
})
