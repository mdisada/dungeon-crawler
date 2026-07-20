import { useState } from 'react'

import {
  claimAssistSlot, requestHint, resolveExpiredPrompt, rollPendingPrompt, sendPlayerIntent,
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
    // Unified input (2026-07-20): everything typed goes as one utterance the server
    // interprets - the old say/do split lives on only in the wire kind for compatibility.
    say: (text: string, targetId?: string) =>
      run(() => sendPlayerIntent(adventure.id, { kind: 'say', text, target_id: targetId })),
    roll: (skill: string) => run(() => sendPlayerIntent(adventure.id, { kind: 'roll', skill })),
    rollPending: (promptId: string, skill?: string) => run(() => rollPendingPrompt(adventure.id, promptId, skill)),
    requestHint: () => run(() => requestHint(adventure.id)),
    claimAssist: (promptId: string) => run(() => claimAssistSlot(adventure.id, promptId)),
    resolveExpired: (promptId: string) => run(() => resolveExpiredPrompt(adventure.id, promptId)),
  }
}
