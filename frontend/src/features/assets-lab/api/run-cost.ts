import { supabase } from '@/lib/supabase'

/**
 * Best-effort cost attribution for a lab run.
 *
 * usage_log has no job id (ai-proxy writes it from the server side, which never sees one), so a
 * run is matched by kind + the newest row written after it started. That is exact while runs are
 * sequential, which they are here - the lab fires one at a time. Returns null rather than
 * guessing if nothing matches; the OpenRouter audio endpoint in particular only reports cost via
 * a follow-up stats lookup that can lag.
 */
export async function fetchRunCost(kind: 'image' | 'tts', startedAtIso: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('usage_log')
    .select('cost_usd')
    .eq('kind', kind)
    .gte('created_at', startedAtIso)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  const cost = data[0].cost_usd
  return cost === null ? null : Number(cost)
}
