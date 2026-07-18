import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { generateWorkerToken } from '../api/generate-worker-token'
import type { WorkerStatusLevel } from '../types'

const STATUS_LABEL: Record<WorkerStatusLevel, string> = {
  green: 'Connected',
  yellow: 'Reconnecting…',
  red: 'Not connected',
}

interface Props {
  workerStatus: WorkerStatusLevel | null
}

export function WorkerTokenSection({ workerStatus }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setError(null)
    try {
      const newToken = await generateWorkerToken()
      setToken(newToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Local server</h2>
      <p className="text-sm text-muted-foreground">
        Status: {workerStatus ? STATUS_LABEL[workerStatus] : 'Unknown'}. No local worker ships yet
        (F12) -- this generates the token a future worker process would authenticate with.
      </p>
      <Button type="button" variant="outline" onClick={handleGenerate} className="self-start">
        Generate worker token
      </Button>
      {token && (
        <p className="rounded border border-border bg-muted p-2 font-mono text-sm break-all">
          {token} -- copy this now, it will not be shown again.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
