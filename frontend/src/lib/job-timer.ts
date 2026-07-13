export type JobTiming = {
  jobId: string
  label: string
  durationMs: number
  durationLabel: string
}

/** Formats a duration in milliseconds as e.g. "3h 23min 45s 32ms", dropping leading zero units. */
export function formatDuration(ms: number): string {
  const totalMs = Math.round(ms)
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (hours > 0 || minutes > 0) parts.push(`${minutes}min`)
  if (hours > 0 || minutes > 0 || seconds > 0) parts.push(`${seconds}s`)
  parts.push(`${millis}ms`)

  return parts.join(' ')
}

/**
 * Wrap any request that crosses the client/backend boundary (realtime signals now,
 * text/audio/image generation later) so every job's round-trip duration is measured
 * and logged the same way, and can be compared against the backend's `time_job`
 * (backend/timing.py).
 */
export async function timeJob<T>(
  label: string,
  fn: (jobId: string) => Promise<T>,
): Promise<{ result: T; timing: JobTiming }> {
  const jobId = crypto.randomUUID()
  const start = performance.now()
  const result = await fn(jobId)
  const durationMs = performance.now() - start
  const durationLabel = formatDuration(durationMs)
  const timing: JobTiming = { jobId, label, durationMs, durationLabel }
  console.log(`[job-timer] ${label} (${jobId}): ${durationLabel}`)
  return { result, timing }
}
