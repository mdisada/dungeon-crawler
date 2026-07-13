import { useEffect, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { listModels } from '../api/list-models'

type Status = 'loading' | 'ready' | 'error'

export type ModelOption = { value: string; label: string }

export function useModelOptions() {
  const [status, setStatus] = useState<Status>('loading')
  const [options, setOptions] = useState<ModelOption[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setStatus('loading')
      setError(null)
      try {
        const { result } = await timeJob('list-models', (jobId) => listModels(jobId))
        if (cancelled) return

        const openrouter: ModelOption[] = result.openrouterModels.map((m) => ({
          value: m,
          label: `${m} (OpenRouter)`,
        }))
        const ollama: ModelOption[] = result.ollamaAvailable
          ? result.ollamaModels.map((m) => ({ value: m, label: `${m} (Ollama)` }))
          : []

        setOptions([...openrouter, ...ollama])
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStatus('error')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { status, options, error }
}
