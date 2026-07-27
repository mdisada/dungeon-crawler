// Authored prose must be readable (2026-07-28).
//
// A generated guide shipped an ending whose climax_summary read "not the官方 story" - two Chinese
// characters spliced mid-sentence by the model. `climax_summary` is the guaranteed floor published
// verbatim when the live climax author fails, so that reaches the player exactly as written.
//
// Nothing checked. Every stage validator asks whether the SHAPE is right; none asks whether the
// text is in the language the adventure is written in.

/**
 * What a guide may legitimately contain: tab/newline, printable ASCII, Latin-1 Supplement and
 * Latin Extended-A (accented names - Fen Tollen is fine, so is Ysolde Ó Braonáin), and the
 * punctuation models actually reach for (curly quotes, dashes, ellipsis, euro sign).
 *
 * Deliberately a WHITELIST. A blacklist of scripts would need extending every time a new one
 * appeared, and the failure mode of missing one is shipping it to the player.
 */
const ALLOWED = /[\t\n\r\x20-\x7E -ɏ‐-›€]/

/** The distinct out-of-range characters in `text`, in first-seen order. Empty when clean. */
export function foreignCharacters(text: string): string[] {
  const seen: string[] = []
  for (const ch of String(text ?? '')) {
    if (ALLOWED.test(ch) || seen.includes(ch)) continue
    seen.push(ch)
  }
  return seen
}

/**
 * A validator error line for a stage reply, or null when the text is clean.
 *
 * Phrased as an instruction the model can act on: naming the characters is what lets the retry
 * find and remove them, rather than regenerating blind and rolling the same dice again.
 */
export function charsetError(text: string): string | null {
  const bad = foreignCharacters(text)
  if (bad.length === 0) return null
  const shown = bad.slice(0, 8).join(' ')
  return (
    `response contains characters outside the adventure's language (${shown}) - ` +
    'rewrite those words in English; do not transliterate or leave placeholders'
  )
}
