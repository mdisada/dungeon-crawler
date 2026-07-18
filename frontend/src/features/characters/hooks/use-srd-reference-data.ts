import { useEffect, useState } from 'react'

import { listSrdBackgrounds } from '../api/list-srd-backgrounds'
import { listSrdClasses } from '../api/list-srd-classes'
import { listSrdFeats } from '../api/list-srd-feats'
import { listSrdRaces } from '../api/list-srd-races'
import type { SrdBackground, SrdClass, SrdFeat, SrdRace } from '../types'

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; races: SrdRace[]; classes: SrdClass[]; backgrounds: SrdBackground[]; feats: SrdFeat[] }

interface SrdReferenceData {
  races: SrdRace[]
  classes: SrdClass[]
  backgrounds: SrdBackground[]
  feats: SrdFeat[]
  isLoading: boolean
  error: string | null
}

// Reference tables are small (9 races, ~12 classes, 4 backgrounds, 17 feats) and read-only, so
// the whole wizard fetches them once on mount rather than per-step.
export function useSrdReferenceData(): SrdReferenceData {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    Promise.all([listSrdRaces(), listSrdClasses(), listSrdBackgrounds(), listSrdFeats()])
      .then(([races, classes, backgrounds, feats]) => {
        if (!cancelled) setState({ status: 'ready', races, classes, backgrounds, feats })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load SRD data' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    races: state.status === 'ready' ? state.races : [],
    classes: state.status === 'ready' ? state.classes : [],
    backgrounds: state.status === 'ready' ? state.backgrounds : [],
    feats: state.status === 'ready' ? state.feats : [],
    isLoading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
  }
}
