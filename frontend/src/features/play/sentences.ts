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
