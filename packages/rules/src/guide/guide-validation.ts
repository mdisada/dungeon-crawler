// F04 SS6: "Start Adventure" validation - at least one objective per chapter, every objective
// has a valid completion predicate, at least one location exists, and exactly one valid entry
// quest contract (F04 SS4.3 - the opening offer that gates the first objective). Shared by the
// editor's CTA (disable + explain) and any server-side activation check later (F05).

import { validatePredicate } from './predicates.ts'

export interface ContractForValidation {
  label: string
  isEntry: boolean
  giverNpcId: string | null
  goldFloor: number
  goldCeiling: number
  objectiveIds: string[]
}

export interface GuideForValidation {
  chapters: {
    title: string
    objectives: { title: string; completionPredicates: unknown }[]
  }[]
  locationCount: number
  /** F04 SS4.2: a fluid resolution needs at least two candidate endings. */
  endingCount: number
  contracts: ContractForValidation[]
  /** Known ids for contract ref validation. */
  npcIds: string[]
  objectiveIds: string[]
}

export function validateGuideReady(guide: GuideForValidation): string[] {
  const errors: string[] = []

  if (guide.chapters.length === 0) {
    errors.push('The guide has no chapters.')
  }

  guide.chapters.forEach((chapter, i) => {
    const label = chapter.title || `Chapter ${i + 1}`
    if (chapter.objectives.length === 0) {
      errors.push(`${label} has no objectives.`)
    }
    chapter.objectives.forEach((objective, j) => {
      const objectiveLabel = objective.title || `objective ${j + 1}`
      if (
        objective.completionPredicates == null ||
        validatePredicate(objective.completionPredicates).length > 0
      ) {
        errors.push(`${label}: "${objectiveLabel}" is missing a valid completion predicate.`)
      }
    })
  })

  if (guide.locationCount === 0) {
    errors.push('The guide needs at least one location.')
  }

  if (guide.endingCount < 2) {
    errors.push('The guide needs at least two candidate endings.')
  }

  const entries = guide.contracts.filter((c) => c.isEntry)
  if (entries.length !== 1) {
    errors.push('The guide needs exactly one entry quest contract (the opening offer).')
  }
  const npcIds = new Set(guide.npcIds)
  const objectiveIds = new Set(guide.objectiveIds)
  guide.contracts.forEach((contract) => {
    const label = contract.label || (contract.isEntry ? 'the entry contract' : 'a quest contract')
    if (!contract.giverNpcId || !npcIds.has(contract.giverNpcId)) {
      errors.push(`${label}: the giver must be an existing NPC.`)
    }
    if (contract.goldCeiling < contract.goldFloor) {
      errors.push(`${label}: reward ceiling is below the floor.`)
    }
    if (contract.objectiveIds.length === 0 || contract.objectiveIds.some((id) => !objectiveIds.has(id))) {
      errors.push(`${label}: must cover at least one existing objective.`)
    }
  })

  return errors
}
