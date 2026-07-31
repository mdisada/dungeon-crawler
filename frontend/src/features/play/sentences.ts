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
