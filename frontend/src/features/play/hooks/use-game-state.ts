import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { applyDiffs } from '@rules/state'
import type { FxEvent, GameState, StateDiff } from '@rules/state'

import { fetchResync } from '../api/session'
import type { ConnectionStatus, PlayRole, SessionEndedCard } from '../types'

interface DiffMessage {
  state_version: number
  diffs: StateDiff[]
  fx?: FxEvent[]
}

export type GameStateHook =
  | { status: 'connecting' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      state: GameState
      version: number
      role: PlayRole
      spectator: boolean
      connection: ConnectionStatus
      fx: FxEvent[]
      endedCard: SessionEndedCard | null
      dismissEndedCard: () => void
      forceResync: () => void
    }

/**
 * Subscribes to game:{id} (and dm:{id} for DMs), applies state diffs through the shared
 * @rules/state contract, and resyncs on join, reconnect, version gaps, and restore signals.
 * Everything the play page renders derives from this state (F06 SS1: pure derived UI).
 */
export function useGameState(adventureId: string): GameStateHook {
  const [snapshot, setSnapshot] = useState<{ state: GameState; version: number; role: PlayRole; spectator: boolean } | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [fx, setFx] = useState<FxEvent[]>([])
  const [endedCard, setEndedCard] = useState<SessionEndedCard | null>(null)
  // Serialize resyncs and version checks across async channel callbacks.
  const versionRef = useRef(0)
  const resyncingRef = useRef(false)

  const resync = useCallback(async () => {
    if (resyncingRef.current) return
    resyncingRef.current = true
    try {
      const data = await fetchResync(adventureId)
      versionRef.current = data.state_version
      setSnapshot({
        state: data.state as GameState,
        version: data.state_version,
        role: data.role,
        spectator: data.spectator,
      })
      setConnection('live')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game state')
    } finally {
      resyncingRef.current = false
    }
  }, [adventureId])

  useEffect(() => {
    let cancelled = false

    const handleDiff = (payload: DiffMessage) => {
      if (cancelled) return
      if (payload.state_version <= versionRef.current) return
      if (payload.state_version > versionRef.current + 1) {
        void resync()
        return
      }
      versionRef.current = payload.state_version
      setSnapshot((prev) =>
        prev
          ? { ...prev, state: applyDiffs(prev.state, payload.diffs), version: payload.state_version }
          : prev,
      )
      if (payload.fx && payload.fx.length > 0) {
        setFx((prev) => [...prev, ...payload.fx!])
        // Transient by contract - clear after the animation window.
        setTimeout(() => setFx((prev) => prev.slice(payload.fx!.length)), 2500)
      }
    }

    const game = supabase.channel(`game:${adventureId}`, { config: { private: true } })
    game
      .on('broadcast', { event: 'state_diff' }, ({ payload }) => handleDiff(payload as unknown as DiffMessage))
      .on('broadcast', { event: 'resync_required' }, () => void resync())
      .on('broadcast', { event: 'session_ended' }, ({ payload }) => {
        const p = payload as { session_id: string; index: number; summary: Record<string, string[]>; xp_gained: number }
        setEndedCard({ sessionId: p.session_id, index: p.index, summary: p.summary, xpGained: p.xp_gained, costUsd: null })
      })
      .subscribe((status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') void resync()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('reconnecting')
        else if (status === 'CLOSED') setConnection('reconnecting')
      })

    return () => {
      cancelled = true
      void supabase.removeChannel(game)
    }
  }, [adventureId, resync])

  // DM channel joins only once the resync proves the caller is the DM (players are denied by RLS).
  const role = snapshot?.role
  useEffect(() => {
    if (role !== 'dm') return
    const dm = supabase.channel(`dm:${adventureId}`, { config: { private: true } })
    dm.on('broadcast', { event: 'state_diff' }, ({ payload }) => {
      const message = payload as unknown as DiffMessage
      versionRef.current = Math.max(versionRef.current, message.state_version)
      setSnapshot((prev) =>
        prev ? { ...prev, state: applyDiffs(prev.state, message.diffs), version: versionRef.current } : prev,
      )
    }).subscribe()
    return () => {
      void supabase.removeChannel(dm)
    }
  }, [adventureId, role])

  const dismissEndedCard = useCallback(() => setEndedCard(null), [])
  const forceResync = useCallback(() => void resync(), [resync])

  if (error && !snapshot) return { status: 'error', message: error }
  if (!snapshot) return { status: 'connecting' }
  return {
    status: 'ready',
    state: snapshot.state,
    version: snapshot.version,
    role: snapshot.role,
    spectator: snapshot.spectator,
    connection,
    fx,
    endedCard,
    dismissEndedCard,
    forceResync,
  }
}
