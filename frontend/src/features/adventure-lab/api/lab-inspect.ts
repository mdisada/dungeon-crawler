import { callEdgeFunction } from '@/lib/edge-function'

import type { LabEntry, Playthrough } from '../types'

async function callSession<T>(body: Record<string, unknown>): Promise<T> {
  const res = await callEdgeFunction('session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `lab action failed (${res.status})`)
  return json as T
}

/** Unified selectable list: lab test runs + real playthroughs. `all` needs debug rights server-side. */
export function fetchLabEntries(scope: 'mine' | 'all'): Promise<{ runs: LabEntry[] }> {
  return callSession({ action: 'lab_list', scope })
}

/** One adventure's event_log, translated to per-turn cards + an anomaly list. */
export function fetchPlaythrough(adventureId: string): Promise<Playthrough> {
  return callSession({ action: 'lab_inspect', adventure_id: adventureId })
}
