import type { WorkerStatusLevel } from './types'

const GREEN_THRESHOLD_MS = 30_000
const YELLOW_THRESHOLD_MS = 90_000

/** Pure so it's unit-testable without mocking time via a running hook (F01 SS5). */
export function getWorkerStatusLevel(lastHeartbeatAt: string | null, now: number = Date.now()): WorkerStatusLevel {
  if (!lastHeartbeatAt) return 'red'
  const age = now - new Date(lastHeartbeatAt).getTime()
  if (age < GREEN_THRESHOLD_MS) return 'green'
  if (age < YELLOW_THRESHOLD_MS) return 'yellow'
  return 'red'
}
