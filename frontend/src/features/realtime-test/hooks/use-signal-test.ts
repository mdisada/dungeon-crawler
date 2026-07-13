import { useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { sendPing } from '../api/send-ping'

type Status = 'idle' | 'sending' | 'success' | 'error'

export function useSignalTest() {
  const [status, setStatus] = useState<Status>('idle')
  const [lastDurationLabel, setLastDurationLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendSignal = async () => {
    setStatus('sending')
    setError(null)
    try {
      const { timing } = await timeJob('realtime-signal-test', (jobId) => sendPing(jobId))
      setLastDurationLabel(timing.durationLabel)
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  return { status, lastDurationLabel, error, sendSignal }
}
