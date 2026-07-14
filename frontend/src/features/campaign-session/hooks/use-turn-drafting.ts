import { useEffect, useRef, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { subscribeToBroadcast } from '@/lib/realtime-channel'
import { generateBranchOptions } from '../api/generate-branch-options'
import { generateTurn } from '../api/generate-turn'
import { publishTurn } from '../api/publish-turn'
import { CAMPAIGN_LIVE_TOPIC } from '../constants'
import type { BranchOptionsEvent } from '../types'

type Status = 'idle' | 'loading-options' | 'generating' | 'publishing'

// Grace period after picking an option / short custom direction during which the DM can edit
// the draft to cancel the auto-publish, before it goes out to players on its own.
const AUTO_PUBLISH_DELAY_SECONDS = 5

/** DM-only: after a player's turn is published, the backend auto-suggests a handful of short
 * one-sentence directions (picked up here via broadcast) instead of drafting a full turn
 * outright. The DM picks one, writes their own via `feedback`, or asks for options manually —
 * either way `generate` turns the chosen direction into the full narration draft, which the DM
 * can then edit and publish. Picking an option or submitting a short custom direction schedules
 * an auto-publish of that draft; editing the draft during the countdown cancels it. */
export function useTurnDrafting(campaignId: number) {
  const [options, setOptions] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [autoPublishSecondsLeft, setAutoPublishSecondsLeft] = useState<number | null>(null)
  const autoPublishTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return subscribeToBroadcast<BranchOptionsEvent>(CAMPAIGN_LIVE_TOPIC, 'branch-options-generated', (event) => {
      if (event.campaignId !== campaignId) return
      if (event.error) setError(event.error)
      else if (event.options) setOptions(event.options)
    })
  }, [campaignId])

  // Stop the ticking countdown, if one is running, without publishing.
  const cancelAutoPublish = () => {
    if (autoPublishTimerRef.current) {
      clearInterval(autoPublishTimerRef.current)
      autoPublishTimerRef.current = null
    }
    setAutoPublishSecondsLeft(null)
  }

  useEffect(() => cancelAutoPublish, [])

  const generateOptions = async () => {
    setStatus('loading-options')
    setError(null)
    try {
      const { result } = await timeJob('generate-branch-options', (jobId) => generateBranchOptions(jobId, campaignId))
      setOptions(result.options)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  const publishContent = async (content: string) => {
    cancelAutoPublish()
    if (!content.trim()) return
    setStatus('publishing')
    setError(null)
    try {
      await timeJob('publish-turn', (jobId) => publishTurn(jobId, campaignId, content, 'dm'))
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  const scheduleAutoPublish = (content: string) => {
    setAutoPublishSecondsLeft(AUTO_PUBLISH_DELAY_SECONDS)
    autoPublishTimerRef.current = setInterval(() => {
      setAutoPublishSecondsLeft((prev) => {
        if (prev === null) return null
        if (prev <= 1) {
          if (autoPublishTimerRef.current) clearInterval(autoPublishTimerRef.current)
          autoPublishTimerRef.current = null
          void publishContent(content)
          return null
        }
        return prev - 1
      })
    }, 1000)
  }

  const generate = async (withFeedback?: string, opts?: { autoPublish?: boolean }) => {
    setStatus('generating')
    setError(null)
    try {
      const { result } = await timeJob('generate-turn', (jobId) => generateTurn(jobId, campaignId, withFeedback))
      setDraft(result.content)
      setFeedback('')
      setOptions([])
      if (opts?.autoPublish) scheduleAutoPublish(result.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  const publish = () => publishContent(draft)

  // Exposed to the draft textarea: editing the draft during the auto-publish countdown cancels it.
  const updateDraft = (value: string) => {
    cancelAutoPublish()
    setDraft(value)
  }

  return {
    options,
    draft,
    setDraft: updateDraft,
    feedback,
    setFeedback,
    status,
    error,
    autoPublishSecondsLeft,
    cancelAutoPublish,
    generateOptions,
    generate,
    publish,
  }
}
