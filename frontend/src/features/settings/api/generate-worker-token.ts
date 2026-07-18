import { callEdgeFunction } from '@/lib/edge-function'

/** Returns the plaintext worker token exactly once -- the server only ever stores its hash. */
export async function generateWorkerToken(): Promise<string> {
  const res = await callEdgeFunction('worker-token', { method: 'POST' })
  if (!res.ok) throw new Error(`worker-token request failed: ${res.status}`)
  const json: { token: string } = await res.json()
  return json.token
}
