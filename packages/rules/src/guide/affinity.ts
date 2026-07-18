// F04 SS4.1: split-clue reveals_to affinities are abstract at guide time ({"skill":"religion"})
// because real characters aren't known yet. At first session start (F05), the Hook Weaver's
// deferred pass binds each coop-set member to a concrete DISTINCT character; unbindable members
// degrade gracefully to "any_pc". Pure so the acceptance-criteria fixtures (3-PC and 1-PC party
// against the same guide) can drive it directly.

import type { AffinityRef } from './types.ts'

export interface PartyCharacter {
  id: string
  className: string
  skills: string[]
  backgroundTags: string[]
}

export interface CoopMember {
  ingredientId: string
  revealsTo: AffinityRef | null
}

export type AffinityBinding = { ingredientId: string; boundTo: string | 'any_pc' }

function matches(affinity: AffinityRef, character: PartyCharacter): boolean {
  if (affinity.character_id !== undefined) return affinity.character_id === character.id
  if (affinity.class !== undefined) return affinity.class.toLowerCase() === character.className.toLowerCase()
  if (affinity.skill !== undefined) {
    return character.skills.some((s) => s.toLowerCase() === affinity.skill!.toLowerCase())
  }
  if (affinity.background_tag !== undefined) {
    return character.backgroundTags.some((t) => t.toLowerCase() === affinity.background_tag!.toLowerCase())
  }
  return false
}

/**
 * Binds one coop set's members to distinct party characters, maximizing the number of bound
 * members (maximum bipartite matching via augmenting paths - sets have 2-3 members, parties
 * up to 8, so brute simplicity wins). Members that can't get a distinct match become 'any_pc'.
 */
export function bindCoopSet(members: CoopMember[], party: PartyCharacter[]): AffinityBinding[] {
  const candidateLists = members.map((m) =>
    m.revealsTo === null ? [] : party.filter((c) => matches(m.revealsTo!, c)).map((c) => c.id),
  )

  const assignedTo = new Map<string, number>()

  function tryAssign(memberIndex: number, visited: Set<string>): boolean {
    for (const charId of candidateLists[memberIndex]) {
      if (visited.has(charId)) continue
      visited.add(charId)
      const holder = assignedTo.get(charId)
      if (holder === undefined || tryAssign(holder, visited)) {
        assignedTo.set(charId, memberIndex)
        return true
      }
    }
    return false
  }

  for (let i = 0; i < members.length; i++) {
    tryAssign(i, new Set())
  }

  const byMember = new Map<number, string>()
  for (const [charId, memberIndex] of assignedTo) byMember.set(memberIndex, charId)

  return members.map((m, i) => ({
    ingredientId: m.ingredientId,
    boundTo: byMember.get(i) ?? 'any_pc',
  }))
}
