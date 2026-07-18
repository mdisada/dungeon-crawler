import { callEdgeFunction } from '@/lib/edge-function'

export async function getAiCredit(): Promise<number | null> {
  const res = await callEdgeFunction('ai-credit', { method: 'GET' })
  if (!res.ok) throw new Error(`ai-credit request failed: ${res.status}`)
  const json: { credit_usd: number | null } = await res.json()
  return json.credit_usd
}
