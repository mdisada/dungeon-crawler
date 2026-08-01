const TERMINATORS = new Set(['.', '!', '?'])
/** Punctuation that closes a quote or bracket and so belongs to the sentence it ends. */
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']'])

/**
 * Splits a dialogue line into the sentences the renderers reveal one click at a time.
 *
 * Two rules a plain `split` on [.!?] gets wrong:
 * - a closing quote after the stop stays with its sentence, or a line ending in speech leaves a
 *   lone `"` as the last thing the player has to click through;
 * - a stop only ends a sentence when whitespace (or the end of the line) follows, which keeps
 *   decimals like "3.5" and "10.d4" in one piece.
 *
 * Lossless: the pieces rejoin into the original text, trailing spaces and all.
 */
export function splitSentences(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0

  while (i < text.length) {
    if (!TERMINATORS.has(text[i])) {
      i++
      continue
    }
    let end = i + 1
    while (end < text.length && (TERMINATORS.has(text[end]) || CLOSERS.has(text[end]))) end++
    if (end < text.length && !/\s/.test(text[end])) {
      i = end
      continue
    }
    while (end < text.length && /\s/.test(text[end])) end++
    parts.push(text.slice(start, end))
    start = end
    i = end
  }

  if (start < text.length) parts.push(text.slice(start))
  return parts
}

/**
 * How much text one click may put in the box. Sized to the narration subtitle box and the
 * roleplay name-plated box (~3 lines at their widths), so a chunk never overflows either.
 */
export const REVEAL_MAX_CHARS = 240

/**
 * Groups a line into the pieces the renderers reveal one click at a time: as many whole
 * sentences as fit the budget, never a partial one. A single sentence longer than the budget
 * stands alone - splitting it would show the player half a thought.
 *
 * Lossless like `splitSentences`: the chunks rejoin into the original text.
 */
/**
 * How a line is cut into the pieces sent for narration synthesis.
 *
 *   box      - one clip per text box. Best prosody, but the player waits on a whole box.
 *   sentence - one clip per sentence throughout. Fastest first clip, most seams.
 *   lead     - only the FIRST box is split into sentences; the rest stay whole.
 */
export type NarrationSplit = 'box' | 'sentence' | 'lead'

export interface NarrationUnits {
  /** What the player clicks through. Always whole sentences up to the box budget. */
  boxes: string[]
  /** What is sent for synthesis, in order. */
  units: string[]
  /** unitsFor[boxIndex] lists the unit indices that box plays, in order. */
  unitsFor: number[][]
}

/**
 * Splits a line into boxes, and separately into synthesis units.
 *
 * `lead` is the default because of what the first box costs: measured 2026-08-01, a 195-char box
 * takes ~4.6s to synthesize, and the player stares at the previous beat for all of it. Its first
 * sentence alone took ~0.9s. Splitting only that box buys back most of the wait while leaving
 * every later box whole, so the seams a per-sentence split introduces appear once per line rather
 * than throughout - and by the time the player reaches box 2, synthesis is well ahead of them.
 */
export function splitNarration(
  text: string,
  maxChars: number = REVEAL_MAX_CHARS,
  split: NarrationSplit = 'lead',
): NarrationUnits {
  const boxes = chunkSentences(text, maxChars)
    .map((box) => box.trim())
    .filter(Boolean)

  if (split === 'box') {
    return { boxes, units: boxes, unitsFor: boxes.map((_, index) => [index]) }
  }

  const units: string[] = []
  const unitsFor: number[][] = []
  for (const [boxIndex, box] of boxes.entries()) {
    const wholeBox = split === 'lead' && boxIndex > 0
    const pieces = wholeBox
      ? [box]
      : splitSentences(box)
          .map((sentence) => sentence.trim())
          .filter(Boolean)
    const indices = pieces.map((piece) => units.push(piece) - 1)
    // A box whose sentences all trimmed away still needs an entry, or every later box would map
    // to the wrong audio.
    unitsFor.push(indices.length > 0 ? indices : [units.push(box) - 1])
  }
  return { boxes, units, unitsFor }
}

/**
 * How many leading BOXES are playable, given how many leading units have settled.
 *
 * A box is playable only when every unit it plays has settled - otherwise the chevron would offer
 * a box that runs out of audio halfway through. The one exception is the first box under `lead`,
 * which the caller deliberately reveals on its first sentence; see useNarration.
 */
export function settledBoxCount(unitsFor: number[][], settledUnits: number): number {
  let count = 0
  while (count < unitsFor.length) {
    const last = unitsFor[count][unitsFor[count].length - 1]
    if (last >= settledUnits) break
    count++
  }
  return count
}

export function chunkSentences(text: string, maxChars: number = REVEAL_MAX_CHARS): string[] {
  const chunks: string[] = []
  let current = ''

  for (const sentence of splitSentences(text)) {
    if (current && (current + sentence).trimEnd().length > maxChars) {
      chunks.push(current)
      current = sentence
      continue
    }
    current += sentence
  }

  if (current) chunks.push(current)
  return chunks
}
