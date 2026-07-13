import { useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { publishTurn } from '../api/publish-turn'

type Status = 'idle' | 'sending'

/** Player-facing: the player's own stated action is auto-published (no DM approval gate — the
 * DM only reviews the AI's narration, not what the player says). Publishing it also triggers the
 * backend to draft the next AI turn in the background (see make_handle_publish_turn). */
export function usePlayerResponse(campaignId: number) {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)

  const submit = async () => {
    if (!content.trim()) return
    setStatus('sending')
    setError(null)
    try {
      await timeJob('publish-turn', (jobId) => publishTurn(jobId, campaignId, content, 'player'))
      setContent('')
      setJustSubmitted(true)
      setTimeout(() => setJustSubmitted(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  return { content, setContent, status, error, submit, justSubmitted }
}
