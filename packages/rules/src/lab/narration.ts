// The Narration tab's source: the player-facing transcript (dialogue lines the table actually
// saw), annotated with the two narrative-bug flags detectable from the prose alone - a mechanical
// fallback (the narrator failed and the canned line shipped) and a duplicate line (the scene text
// repeated) - AND correlated to the Logs turn that produced each line, so clicking a narration
// jumps to its mechanics. Deeper flags (blocked/regenerated drafts) live in the Logs/Issues view.
// Pure + unit-tested.

export interface RawLine {
  speaker: string | null
  text: string
}

export type NarrationFlag = 'fallback' | 'duplicate'

export interface NarrationLine {
  speaker: string | null
  text: string
  flag: NarrationFlag | null
  /** The Logs turn this line belongs to, for cross-navigation. 0 = the setup card. */
  turnIndex: number
}

/** A turn-tagged, pre-keyed line-producing event (narration/say/intent), from the Logs turns. */
export interface NarrationAnchor {
  turnIndex: number
  text: string
}

// narration.ts MECHANICAL_FALLBACK, duplicated here (edge-only module, not mirrored). If that
// constant changes, change this - a lab test would not catch prod drift, so keep them in step.
const MECHANICAL_FALLBACK = 'The attempt is resolved; the outcome stands.'
const LOOKAHEAD = 12

/** The match key shared by anchors and lines - a normalized prefix stable across sources. */
export function narrationKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
}

export function annotateNarration(lines: RawLine[], anchors: NarrationAnchor[] = []): NarrationLine[] {
  let prev = ''
  let pointer = 0
  let lastTurn = 0
  return lines.map((line) => {
    const key = narrationKey(line.text)

    let flag: NarrationFlag | null = null
    if (line.text.trim() === MECHANICAL_FALLBACK) flag = 'fallback'
    else if (key && key === prev) flag = 'duplicate'
    prev = key

    // Ordered forward match: DM narration + player lines carry text and line up with an anchor;
    // NPC lines (no text-bearing event) find no match and inherit the surrounding turn.
    let turnIndex = lastTurn
    for (let i = pointer; i < Math.min(anchors.length, pointer + LOOKAHEAD); i++) {
      if (key && anchors[i].text === key) {
        turnIndex = anchors[i].turnIndex
        pointer = i + 1
        break
      }
    }
    lastTurn = turnIndex

    return { speaker: line.speaker ?? null, text: line.text, flag, turnIndex }
  })
}
