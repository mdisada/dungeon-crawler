// Player-theory canonization, gated on a player having actually said it (2026-07-23).
//
// `canonize_theory` is the NPC Agent's route to writing PERMANENT world truth - it inserts a
// `secret` ingredient that is canon from then on. Its only guard was a consistency verdict that
// cannot fail: canon.text ends "RESTRICTIONS: none. Nothing in this scene can be contradicted",
// and the checker's prompt classifies novel assertions as never violations. Measured across
// every paid run: 3 theories proposed, 3 auto-applied, 0 ever blocked.
//
// The worse half of the finding is that none of those three was said by a player. The feature is
// specified as "the party theorises, the DM makes it true" (F08 SS5) - a player-agency feature -
// and in practice the NPC Agent was inventing the theory AND granting it.
//
// So the gate is not "is this consistent?" (a question the model answers badly and cannot fail)
// but "did a player assert this?" - a question with a closed, code-owned answer set: the player
// lines actually in this scene. Model perceives which line, code decides what that means. Same
// split as play/claims.ts.

/** A line the party actually said, with its position in the closed menu. */
export interface PlayerLine {
  index: number
  speaker: string
  text: string
}

/**
 * The menu: what the PARTY said in this scene, most recent last. Structural - a line belongs to
 * a player when its speaker is a party member and it carries no npcId, which is exactly how
 * `newLine` records a PC utterance.
 */
export function playerLines(
  lines: readonly { speaker?: string | null; npcId?: string | null; text: string }[],
  pcNames: readonly string[],
  limit = 8,
): PlayerLine[] {
  const names = new Set(pcNames.map((n) => n.toLowerCase().trim()).filter(Boolean))
  const mine: PlayerLine[] = []
  for (const line of lines) {
    const speaker = (line.speaker ?? '').toLowerCase().trim()
    if (!speaker || line.npcId || !names.has(speaker)) continue
    if (!line.text?.trim()) continue
    mine.push({ index: mine.length, speaker: line.speaker ?? '', text: line.text })
  }
  // Keep the most recent, then renumber so indices match the menu the model is shown.
  return mine.slice(-limit).map((l, index) => ({ ...l, index }))
}

export interface GroundingVerdict {
  /** Index into the menu, or null for "no player said this". */
  lineIndex: number | null
}

/**
 * Unknown/garbage degrades to null - ungrounded, which refuses to canonize.
 *
 * Accepts a BARE NUMBER as well as `{line_index}`: asked for a single integer, the model
 * answered with the scalar `-1` rather than an object (live 2026-07-23). The prompt now states
 * the shape, but a parser that only understands one of two obvious encodings of the same answer
 * is a parser waiting to throw away a correct reply.
 */
export function parseGrounding(raw: unknown, menuSize: number): GroundingVerdict {
  if (typeof raw === 'number') return parseGrounding({ line_index: raw }, menuSize)
  const root = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const value = root.line_index
  if (typeof value !== 'number' || !Number.isInteger(value)) return { lineIndex: null }
  if (value < 0 || value >= menuSize) return { lineIndex: null }
  return { lineIndex: value }
}

export interface GroundingDecision {
  canonize: boolean
  reason: 'grounded' | 'no_player_lines' | 'not_asserted'
  /** The line that grounds it, for the event log. */
  source: PlayerLine | null
}

/**
 * The verdict, in code. Default is refusal: canon is permanent and unrecoverable in play, so an
 * unmatched theory is dropped rather than granted. Losing a real theory costs the party one
 * "make it true" moment; granting an invented one rewrites the world with nobody's consent.
 */
export function decideCanonization(
  menu: readonly PlayerLine[],
  verdict: GroundingVerdict,
): GroundingDecision {
  if (menu.length === 0) return { canonize: false, reason: 'no_player_lines', source: null }
  if (verdict.lineIndex === null) return { canonize: false, reason: 'not_asserted', source: null }
  const source = menu.find((l) => l.index === verdict.lineIndex) ?? null
  if (!source) return { canonize: false, reason: 'not_asserted', source: null }
  return { canonize: true, reason: 'grounded', source }
}
