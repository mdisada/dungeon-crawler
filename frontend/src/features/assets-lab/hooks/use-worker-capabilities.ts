import { useEffect, useState } from 'react'

import { getWorkerCapabilities, type WorkerCapabilities } from '@/lib/asset-job'

type State =
  | { status: 'checking' }
  | { status: 'online'; capabilities: WorkerCapabilities }
  | { status: 'offline'; reason: string }

/**
 * Asks the local worker what it can do. A timeout means no worker is listening, which is the
 * normal case - the lab disables the local route with that reason rather than letting a run hang.
 * `nonce` bumps to force a re-probe (the manual "retry" button).
 */
export function useWorkerCapabilities(userId: string | null) {
  const [state, setState] = useState<State>({ status: 'checking' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getWorkerCapabilities(userId, crypto.randomUUID())
      .then((capabilities) => {
        if (!cancelled) setState({ status: 'online', capabilities })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'offline', reason: err instanceof Error ? err.message : 'No worker' })
      })
    return () => {
      cancelled = true
    }
  }, [userId, nonce])

  return { state, recheck: () => setNonce((n) => n + 1) }
}
