import { useCallback, useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

import { listLobbyMembers, listOwnCompleteCharacters } from '../api/lobby'
import * as session from '../api/session'
import type { LobbyMember, PickableCharacter } from '../types'

export interface LobbyHook {
  members: LobbyMember[]
  ownCharacters: PickableCharacter[]
  isLoading: boolean
  error: string | null
  warning: string | null
  pick: (characterId: string | null) => Promise<void>
  toggleReady: (ready: boolean) => Promise<void>
  admit: (memberId: string) => Promise<void>
  start: () => Promise<void>
  refresh: () => void
}

/**
 * Lobby state (F05 SS3): member rows via RLS reads, refetched on the server's members_changed
 * nudge; online flags from the lobby presence channel; writes through the session function.
 */
export function useLobby(adventureId: string, userId: string): LobbyHook {
  const [members, setMembers] = useState<LobbyMember[]>([])
  const [ownCharacters, setOwnCharacters] = useState<PickableCharacter[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const refresh = useCallback(() => {
    Promise.all([listLobbyMembers(adventureId), listOwnCompleteCharacters()])
      .then(([memberRows, characters]) => {
        setMembers(memberRows)
        setOwnCharacters(characters)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load lobby'))
      .finally(() => setIsLoading(false))
  }, [adventureId])

  useEffect(() => {
    refresh()
    const channel = supabase.channel(`lobby:${adventureId}`, { config: { private: true } })
    channel
      .on('presence', { event: 'sync' }, () => {
        const present = new Set<string>()
        for (const entries of Object.values(channel.presenceState<{ user_id: string }>())) {
          for (const entry of entries) present.add(entry.user_id)
        }
        setOnlineUserIds(present)
      })
      .on('broadcast', { event: 'members_changed' }, () => refresh())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ user_id: userId })
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [adventureId, userId, refresh])

  const pick = useCallback(
    async (characterId: string | null) => {
      const result = await session.pickCharacter(adventureId, characterId)
      setWarning(result.warning)
      refresh()
    },
    [adventureId, refresh],
  )

  const toggleReady = useCallback(
    async (ready: boolean) => {
      await session.setReady(adventureId, ready)
      refresh()
    },
    [adventureId, refresh],
  )

  const admit = useCallback(
    async (memberId: string) => {
      await session.admitMember(adventureId, memberId)
      refresh()
    },
    [adventureId, refresh],
  )

  const start = useCallback(async () => {
    await session.startSession(adventureId)
  }, [adventureId])

  return {
    members: members.map((m) => ({ ...m, online: onlineUserIds.has(m.userId) })),
    ownCharacters,
    isLoading,
    error,
    warning,
    pick,
    toggleReady,
    admit,
    start,
    refresh,
  }
}
