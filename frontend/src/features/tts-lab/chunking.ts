import { chunkSentences, splitSentences } from '@/features/play'

export type SynthesisUnit = 'box' | 'sentence'

export interface LabChunking {
  /** What the player clicks through - always whole sentences up to the box budget. */
  boxes: string[]
  /** What is sent to Fish: one entry per box, or one per sentence within a box. */
  units: string[]
  /** unitsFor[boxIndex] lists the unit indices that box plays, in order. */
  unitsFor: number[][]
}

/**
 * Splits a script into boxes and, separately, into synthesis units.
 *
 * The two are the same thing in the shipped mode (`box`): one request per text box, which is the
 * unit whose readiness the gate is expressed in. `sentence` exists so the choice can be re-heard -
 * it makes a 3-sentence box three clips played back to back, trading prosody across the sentence
 * boundary for a faster first clip.
 */
export function buildChunking(text: string, maxChars: number, unit: SynthesisUnit): LabChunking {
  const boxes = chunkSentences(text, maxChars).map((box) => box.trim()).filter(Boolean)
  if (unit === 'box') {
    return { boxes, units: boxes, unitsFor: boxes.map((_, index) => [index]) }
  }

  const units: string[] = []
  const unitsFor: number[][] = []
  for (const box of boxes) {
    const sentences = splitSentences(box).map((sentence) => sentence.trim()).filter(Boolean)
    const indices = sentences.map((sentence) => units.push(sentence) - 1)
    // A box whose sentences all collapsed to empty still needs an entry, or the box/unit mapping
    // would shift and every later box would play the wrong audio.
    unitsFor.push(indices.length > 0 ? indices : [units.push(box) - 1])
  }
  return { boxes, units, unitsFor }
}

/**
 * How many leading BOXES are playable, given how many leading units are settled.
 *
 * A box is only settled when every unit it plays is settled, so the per-sentence mode gates on the
 * whole box rather than on its first sentence - otherwise the chevron would appear while the box
 * still had unsynthesized sentences left to read.
 */
export function settledBoxes(unitsFor: number[][], settledUnits: number): number {
  let count = 0
  while (count < unitsFor.length) {
    const last = unitsFor[count][unitsFor[count].length - 1]
    if (last >= settledUnits) break
    count++
  }
  return count
}
