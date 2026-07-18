import { useCallback, useEffect, useState } from 'react'

import { listCharacters } from '../api/list-characters'
import type { CharacterSummary } from '../types'

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; characters: CharacterSummary[] }

interface CharactersList {
  characters: CharacterSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useCharactersList(userId: string | undefined): CharactersList {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refetchToken, setRefetchToken] = useState(0)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    listCharacters(userId)
      .then((characters) => {
        if (!cancelled) setState({ status: 'ready', characters })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load characters' })
      })

    return () => {
      cancelled = true
    }
  }, [userId, refetchToken])

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), [])

  return {
    characters: state.status === 'ready' ? state.characters : [],
    isLoading: userId !== undefined && state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    refetch,
  }
}
