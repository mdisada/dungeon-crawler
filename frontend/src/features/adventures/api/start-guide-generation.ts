import { callEdgeFunction } from '@/lib/edge-function'

// CTA action (F03 SS3.5 -> F04 SS2): kicks off the guide-pipeline edge function, which flips
// the row to 'generating', creates the stage-1 job, and self-chains through all seven stages.
export async function startGuideGeneration(adventureId: string): Promise<void> {
  const res = await callEdgeFunction('guide-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', adventure_id: adventureId }),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? `guide-pipeline start failed (${res.status})`)
  }
}
