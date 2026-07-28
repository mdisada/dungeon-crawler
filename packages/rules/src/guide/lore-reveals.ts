// When may the narrator EXPLAIN a named force, not just name it? (2026-07-28)
//
// `f9d4f6b` withholds every lore note from the narrator, always. That was the right emergency
// fix - the notes are the answers to the objectives, and one leaked verbatim into narration #11
// of run 1de855de, where it became canon and pre-answered an objective that opened 19 narrations
// later. But "always" is too blunt: once the party has done the work, the DM should be able to
// say what the thing IS, and today it never can.
//
// The gate is DERIVED, not authored. An objective's `hidden_description` is the DM's account of
// what happens during it, so the first objective that mentions a force by name is the one that
// puts the party in front of it - and completing that objective is when they have earned the
// explanation. Deriving beats asking a model: there is no call to get wrong, and the answer can
// be stored, inspected and overridden before anyone plays.
//
// SAFETY PROPERTY, and the reason this is shippable at 85% resolution: a name that resolves to no
// objective stays WITHHELD - exactly what happens today. The gate can only ever loosen, never
// leak. Measured over the eight guides generated to date, 28 of 33 lore notes resolve; the other
// five behave precisely as they do now.

/** Lowercase, punctuation-flattened, leading article dropped. "The Tide-Ledger" and
 *  "the tide-ledger" are the same force; matching them literally resolved only 58%. */
export function normalizeLoreName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^\s*the\s+/, '')
    .trim()
}

export interface LoreRevealObjective {
  id: string
  index: number
  title: string
  hiddenDescription: string
}

/**
 * Maps objective id -> the lore names its completion makes explainable.
 *
 * Shaped for storage on `objectives.reveals_lore` rather than as a lookup keyed by lore name: an
 * objective owning what it reveals is what lets canon read the union over COMPLETED objectives
 * with no extra join, and lets a creator see the reveal beside the objective it belongs to.
 */
export function deriveLoreReveals(
  loreNames: readonly string[],
  objectives: readonly LoreRevealObjective[],
): Map<string, string[]> {
  const byObjective = new Map<string, string[]>()
  const ordered = [...objectives].sort((a, b) => a.index - b.index)
  const haystacks = ordered.map((o) => `${normalizeLoreName(o.hiddenDescription)} ${normalizeLoreName(o.title)}`)

  for (const name of loreNames) {
    const needle = normalizeLoreName(name)
    // A one-word or empty needle would match half the guide ("reach", "tide") on substring alone.
    if (needle.length < 4) continue
    // LAST mention, not first. The first objective to name a force is usually the one that sets
    // the party AFTER it, not the one where they understand it - so first-mention released the
    // answer at the worst possible moment. Live on guide ac78e517 it handed the narrator "The
    // Drowned Corpus: a composite sea-entity building itself from the ledger's promised souls, the
    // true creditor" the moment objective 0, "Investigate the missing people", completed. That is
    // the whole mystery, delivered as the party starts investigating it.
    //
    // The last objective that involves a force is the one after which the party has unambiguously
    // finished with it. Measured over five guides this moves 13 of 21 forces later and leaves 8
    // still explainable mid-play; the rest resolve to the final objective and so stay name-only,
    // which is today's behaviour. Erring late costs a note nobody hears. Erring early costs the
    // mystery.
    let i = -1
    haystacks.forEach((h, at) => { if (h.includes(needle)) i = at })
    if (i === -1) continue // unresolved -> stays withheld, which is today's behaviour
    const objectiveId = ordered[i].id
    byObjective.set(objectiveId, [...(byObjective.get(objectiveId) ?? []), name])
  }
  return byObjective
}
