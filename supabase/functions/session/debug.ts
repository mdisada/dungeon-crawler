// Dev-only pipeline telemetry: per-call usage_log rows (agent step, model, latency, cost) for
// the Debug sidebar tab. Email-allowlisted server-side - adventure membership alone is not
// enough, and usage_log RLS attributes rows to the creator so players can't read them directly.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const DEBUG_EMAILS = ['mig.isada@gmail.com']

export async function debugUsage(
  service: SupabaseClient,
  adventureId: string,
  userEmail: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!DEBUG_EMAILS.includes(userEmail.toLowerCase())) {
    return { status: 403, body: { error: 'Debug view is not available for this account' } }
  }
  const [usage, events, stateRow, loops] = await Promise.all([
    service
      .from('usage_log')
      .select('id, agent_role, model, kind, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at, response_text')
      .eq('adventure_id', adventureId)
      .order('created_at', { ascending: false })
      .limit(200),
    service
      .from('event_log')
      .select('id, type, created_at, payload')
      .eq('adventure_id', adventureId)
      .order('id', { ascending: false })
      .limit(150),
    service.from('adventure_state').select('state').eq('adventure_id', adventureId).maybeSingle(),
    service
      .from('core_loops')
      .select('type, status, current_beat_id')
      .eq('adventure_id', adventureId)
      .eq('status', 'active')
      .limit(1),
  ])
  if (usage.error) return { status: 500, body: { error: usage.error.message } }
  if (events.error) return { status: 500, body: { error: events.error.message } }

  // Story snapshot: the "why isn't the story advancing" panel - scene position, active
  // loop/beat with its exit predicate, and the world facts the predicate evaluator sees.
  type Obj = Record<string, unknown>
  const state = (stateRow.data?.state ?? null) as Obj | null
  const scene = (state?.scene ?? {}) as Obj
  const objectives = (state?.objectives ?? {}) as Obj
  const dm = (state?.dm ?? {}) as Obj
  const facts = (dm.facts ?? {}) as Obj
  const activeLoop = ((loops.data ?? []) as { type: string; current_beat_id: string | null }[])[0] ?? null
  const { data: beat } = activeLoop?.current_beat_id
    ? await service.from('beats').select('name, exit_conditions').eq('id', activeLoop.current_beat_id).maybeSingle()
    : { data: null }
  const objectiveList = Array.isArray(objectives.list) ? (objectives.list as Obj[]) : []
  const story = state
    ? {
        mode: scene.mode ?? null,
        location: scene.locationName ?? null,
        day: scene.day ?? null,
        objective: objectiveList.find((o) => o.id === objectives.currentId)?.title ?? null,
        loop: activeLoop
          ? { type: activeLoop.type, beat: beat?.name ?? null, exit_conditions: beat?.exit_conditions ?? null }
          : null,
        off_loop_streak: ((dm.story ?? {}) as Obj).offLoopStreak ?? 0,
        flags: facts.flags ?? {},
        world: facts.world ?? {},
        encounter: (state.encounter as Obj | null | undefined) ?? null,
      }
    : null
  return { status: 200, body: { steps: usage.data ?? [], events: events.data ?? [], story } }
}
