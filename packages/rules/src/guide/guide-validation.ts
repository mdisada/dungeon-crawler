// F04 SS6: "Start Adventure" validation - at least one objective per chapter, every objective
// has a valid completion predicate, and at least one location exists. Shared by the editor's
// CTA (disable + explain) and any server-side activation check later (F05).

import { validatePredicate } from './predicates.ts'

export interface GuideForValidation {
  chapters: {
    title: string
    objectives: { title: string; completionPredicates: unknown }[]
  }[]
  locationCount: number
  /** F04 SS4.2: a fluid resolution needs at least two candidate endings. */
  endingCount: number
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

  return errors
}
