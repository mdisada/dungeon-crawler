// F04 SS7: "every stage regenerable independently without clobbering user edits (regeneration
// proposes a diff view when a row was human-edited)". The pipeline calls decideRegenAction per
// existing row; the editor renders the pending proposal with computeFieldDiff.

export type RegenAction = 'overwrite' | 'propose'

export function decideRegenAction(humanEdited: boolean): RegenAction {
  return humanEdited ? 'propose' : 'overwrite'
}

export interface FieldDiff {
  field: string
  before: unknown
  after: unknown
}

/**
 * Field-level diff between the current row values and a regeneration proposal. Only fields
 * present in `proposed` participate (a proposal never deletes fields it doesn't mention).
 */
export function computeFieldDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const [field, after] of Object.entries(proposed)) {
    const before = current[field]
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      diffs.push({ field, before, after })
    }
  }
  return diffs
}
