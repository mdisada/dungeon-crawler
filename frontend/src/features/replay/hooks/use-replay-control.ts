import { useCallback, useEffect, useState } from 'react'

import {
  endReplaySession,
  enterReplay,
  exitReplay,
  fetchReplayStatus,
  listReplayBattles,
  restartAdventure,
  startReplayCombat,
  startReplaySession,
} from '../api/replay'
import type { ReplayBattle, ReplayStatus } from '../types'

export interface ReplayControl {
  status: ReplayStatus | null
  battles: ReplayBattle[]
  busy: string | null
  error: string | null
  notice: string | null
  refresh: () => void
  enter: () => void
  exit: () => void
  startSession: () => void
  endSession: () => void
  startCombat: (battle: ReplayBattle) => void
  restart: () => void
}

/**
 * Command surface for the replay dev panel. Every action re-reads status afterwards, because the
 * panel is a second observer of state the play screen owns - it never assumes what a command did.
 */
export function useReplayControl(adventureId: string): ReplayControl {
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [battles, setBattles] = useState<ReplayBattle[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void fetchReplayStatus(adventureId)
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Status read failed'))
  }, [adventureId])

  useEffect(() => {
    let cancelled = false
    void fetchReplayStatus(adventureId)
      .then((next) => !cancelled && setStatus(next))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Status read failed')
      })
    void listReplayBattles(adventureId)
      .then((rows) => !cancelled && setBattles(rows))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Battle list failed')
      })
    return () => {
      cancelled = true
    }
  }, [adventureId])

  const run = useCallback(
    (label: string, fn: () => Promise<string>) => {
      setBusy(label)
      setError(null)
      setNotice(null)
      fn()
        .then((message) => setNotice(message))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Command failed'))
        .finally(() => {
          setBusy(null)
          refresh()
        })
    },
    [refresh],
  )

  return {
    status,
    battles,
    busy,
    error,
    notice,
    refresh,
    enter: () =>
      run('enter', async () => {
        const { seats } = await enterReplay(adventureId)
        return `Adventure re-opened; ${seats} seat(s) readied.`
      }),
    exit: () =>
      run('exit', async () => {
        await exitReplay(adventureId)
        return 'Adventure marked completed again.'
      }),
    startSession: () =>
      run('start-session', async () => {
        const { index } = await startReplaySession(adventureId)
        return `Session ${index} started.`
      }),
    endSession: () =>
      run('end-session', async () => {
        await endReplaySession(adventureId)
        return 'Session ended.'
      }),
    startCombat: (battle: ReplayBattle) =>
      run('start-combat', async () => {
        const { combatants } = await startReplayCombat(adventureId, battle.objectiveId, battle.label)
        return `Fight started with ${combatants} combatants.`
      }),
    restart: () =>
      run('restart', async () => {
        const { baseline, rows_restored: rows } = await restartAdventure(adventureId)
        const caveat = baseline === 'backfill' ? ' (reconstructed baseline — approximate)' : ''
        return `Guide restored: ${rows} rows${caveat}. Start a session to play it again.`
      }),
  }
}
