import { useState } from 'react'

import {
  claimAssistSlot, resolveExpiredPrompt, rollPendingPrompt, sendPlayerIntent,
} from '../api/session'
import { usePlay } from './use-play-context'

/**
 * Intent submission for the live table (F07 SS3.1). Serializes one call at a time - the server
 * also rejects overlapping blocking work, this just keeps the UI honest.
 */
export function useIntents() {
  const { adventure, state, userId } = usePlay()
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const me = state.players.list.find((p) => p.userId === userId) ?? null

  async function run(call: () => Promise<unknown>): Promise<boolean> {
    if (isBusy) return false
    setIsBusy(true)
    setError(null)
    try {
      await call()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
      return false
    } finally {
      setIsBusy(false)
    }
  }

  return {
    myCharacterId: me?.characterId ?? null,
    isBusy,
    error,
    clearError: () => setError(null),
    say: (text: string, targetId?: string) =>
      run(() => sendPlayerIntent(adventure.id, { kind: 'say', text, target_id: targetId })),
    act: (text: string) => run(() => sendPlayerIntent(adventure.id, { kind: 'do', text })),
    roll: (skill: string) => run(() => sendPlayerIntent(adventure.id, { kind: 'roll', skill })),
    rollPending: (promptId: string) => run(() => rollPendingPrompt(adventure.id, promptId)),
    claimAssist: (promptId: string) => run(() => claimAssistSlot(adventure.id, promptId)),
    resolveExpired: (promptId: string) => run(() => resolveExpiredPrompt(adventure.id, promptId)),
  }
}
