// The Narration tab's source: the player-facing transcript (dialogue lines the table actually
// saw), annotated with the two narrative-bug flags that are detectable from the prose alone -
// a mechanical fallback (the narrator failed and the canned line shipped) and a duplicate line
// (the scene text repeated). Deeper flags (blocked/regenerated drafts) live in the Logs/Issues
// view, since the blocked draft never reaches the transcript. Pure + unit-tested.

export interface RawLine {
  speaker: string | null
  text: string
}

export type NarrationFlag = 'fallback' | 'duplicate'

export interface NarrationLine {
  speaker: string | null
  text: string
  flag: NarrationFlag | null
}

// narration.ts MECHANICAL_FALLBACK, duplicated here (edge-only module, not mirrored). If that
// constant changes, change this - a lab test would not catch prod drift, so keep them in step.
const MECHANICAL_FALLBACK = 'The attempt is resolved; the outcome stands.'
const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)

export function annotateNarration(lines: RawLine[]): NarrationLine[] {
  let prev = ''
  return lines.map((line) => {
    const key = norm(line.text)
    let flag: NarrationFlag | null = null
    if (line.text.trim() === MECHANICAL_FALLBACK) flag = 'fallback'
    else if (key && key === prev) flag = 'duplicate'
    prev = key
    return { speaker: line.speaker ?? null, text: line.text, flag }
  })
}
