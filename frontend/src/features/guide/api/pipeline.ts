import { callEdgeFunction } from '@/lib/edge-function'

async function callPipeline(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await callEdgeFunction('guide-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `guide-pipeline failed (${res.status})`)
  return json
}

/** Wipes any previous guide content and starts a fresh pipeline run (F04 SS2). */
export function startPipeline(adventureId: string): Promise<unknown> {
  return callPipeline({ action: 'start', adventure_id: adventureId })
}

/** Nudges the runner - used when polling sees queued jobs but nothing running (stall recovery). */
export function runPipeline(adventureId: string): Promise<unknown> {
  return callPipeline({ action: 'run', adventure_id: adventureId })
}

export function retryJob(jobId: string): Promise<unknown> {
  return callPipeline({ action: 'retry', job_id: jobId })
}

export type RegenTable = 'chapters' | 'objectives' | 'npcs' | 'locations' | 'endings'

/** Per-row regenerate: returns 'applied' (row overwritten) or 'proposed' (pending_regen set). */
export async function regenerateRow(table: RegenTable, id: string): Promise<'applied' | 'proposed'> {
  const json = await callPipeline({ action: 'regenerate', table, id })
  return json.result === 'proposed' ? 'proposed' : 'applied'
}
