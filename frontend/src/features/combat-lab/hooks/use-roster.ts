import { useEffect, useState } from 'react'

import { listRosterCharacters, listRosterNpcs } from '../api/roster'
import type { RosterCharacter, RosterNpc } from '../types'

export function useRoster() {
  const [characters, setCharacters] = useState<RosterCharacter[]>([])
  const [npcs, setNpcs] = useState<RosterNpc[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listRosterCharacters(), listRosterNpcs()])
      .then(([chars, npcRows]) => {
        if (cancelled) return
        setCharacters(chars)
        setNpcs(npcRows)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Roster failed to load')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { characters, npcs, status, error }
}
