import { useCallback, useState } from 'react'

import { timeJob } from '@/lib/job-timer'
import { streamAgentText } from '../api/stream-agent-text'

type TestBoxState =
  | { status: 'idle' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string; durationLabel: string }
  | { status: 'error'; error: string }

export function useNarratorTestBox() {
  const [state, setState] = useState<TestBoxState>({ status: 'idle' })

  const run = useCallback(async (userPrompt: string) => {
    setState({ status: 'streaming', text: '' })
    try {
      const { timing } = await timeJob('ai-proxy:narrator-test', () =>
        streamAgentText({
          agentRole: 'narrator',
          systemPrompt: 'You are a fantasy narrator. Reply in two or three short sentences.',
          userPrompt,
          onToken: (delta) => {
            setState((prev) => (prev.status === 'streaming' ? { status: 'streaming', text: prev.text + delta } : prev))
          },
        }),
      )
      setState((prev) =>
        prev.status === 'streaming' ? { status: 'done', text: prev.text, durationLabel: timing.durationLabel } : prev,
      )
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  return { state, run }
}
