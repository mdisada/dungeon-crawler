// A machine-facing label pasted into player-facing prose (2026-07-29, rescoped 2026-07-30).
//
// The narrator is handed `GOAL <objective title>` for orientation and told "never state as a task".
// It states it as a task anyway - as the passage's own closing sentence, in run e87b3506 five times
// in 30 turns:
//
//   "...The rope above sways in a draft that shouldn't reach this floor.
//    Learn why the plague bell tolls."
//
// WHAT THIS IS NOT: a spoiler guard. Both labels it checks are already on the player's screen -
// the objective title in the player sidebar under "Current objective", the encounter label in the
// EncounterBanner ("Social: Earn Netta Vasch's trust"), the latter deliberately, so players always
// know what the game is waiting on. Nothing here is hidden from anyone.
//
// What it is: UI copy restated inside the fiction. An imperative infinitive closing an immersive
// second-person passage, duplicating a string the player can already read two inches to the left.
// The same failure class stripContextEcho handles - the context block bleeding into the output -
// which is why the real fix is upstream (give the narrator an authored diegetic pull instead of a
// quest string) and this stays a backstop rather than the defence.
//
// DELIBERATELY ONLY THE CLOSING SENTENCE. A label mentioned mid-prose is usually the scene being
// described legitimately ("she wants your help auditing the weighbridge"); one standing alone at the
// end is the machine's goal pasted on. The cost of that narrowness is real and known: the same run
// wove "The truth in Voss's cellar waits" into mid-paragraph prose and this could not see it.

/**
 * The label the passage ends on, or null when it ends on prose.
 *
 * Labels shorter than 8 characters are skipped - too short to distinguish a pasted label from a
 * coincidental phrase.
 */
export function trailingLabel(text: string, labels: readonly string[]): string | null {
  const body = (text ?? '').trim()
  if (body.length === 0) return null
  // Smart punctuation is normalised on BOTH sides. Caught by the test that mattered: the narrator
  // wrote "Earn Netta Vasch’s trust" with a curly apostrophe where the stored label has a
  // straight one, and a literal comparison missed the very leak this exists to catch.
  const flatten = (s: string) => s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
  const flatBody = flatten(body)
  for (const raw of labels) {
    const label = (raw ?? '').trim()
    if (label.length < 8) continue
    const tail = flatBody.slice(-(label.length + 2)).replace(/[.!?"'\s]+$/, '')
    if (tail.endsWith(flatten(label))) return label
  }
  return null
}
