import { useEffect, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { subscribeToBroadcast } from '@/lib/realtime-channel'
import { generateTurn } from '../api/generate-turn'
import { publishTurn } from '../api/publish-turn'
import { CAMPAIGN_LIVE_TOPIC } from '../constants'
import type { TurnDraftedEvent } from '../types'

type Status = 'idle' | 'generating' | 'publishing'

/** DM-only: draft the next AI turn (manually, or auto-triggered after a player's turn), edit or
 * redirect it with feedback, then publish it. */
export function useTurnDrafting(campaignId: number) {
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  // A player's turn auto-triggers generation on the backend — pick up the resulting draft here.
  useEffect(() => {
    return subscribeToBroadcast<TurnDraftedEvent>(CAMPAIGN_LIVE_TOPIC, 'turn-drafted', (event) => {
      if (event.campaignId !== campaignId) return
      if (event.error) setError(event.error)
      else if (event.content) setDraft(event.content)
    })
  }, [campaignId])

  const generate = async (withFeedback?: string) => {
    setStatus('generating')
    setError(null)
    try {
      const { result } = await timeJob('generate-turn', (jobId) => generateTurn(jobId, campaignId, withFeedback))
      setDraft(result.content)
      setFeedback('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  const publish = async () => {
    if (!draft.trim()) return
    setStatus('publishing')
    setError(null)
    try {
      await timeJob('publish-turn', (jobId) => publishTurn(jobId, campaignId, draft, 'dm'))
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  return { draft, setDraft, feedback, setFeedback, status, error, generate, publish }
}
