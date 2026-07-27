// Adventure Lab read endpoints (debug-gated, service-role). `lab_list` unifies test runs
// (lab_runs) and real playthroughs (adventures that have entered play) into one selectable list;
// `lab_inspect` turns one adventure's event_log into the plain-English per-turn cards + issues the
// lab renders. Both read across adventures the caller does not own (test runs belong to throwaway
// users), so this is service-role + email-allowlisted rather than RLS - the debug_usage pattern.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { annotateNarration, buildGuideView, buildPlaythrough, narrationKey } from '../_shared/lab/index.ts'
import type { ExplainContext, GuideInput, NarrationAnchor, PlayEvent } from '../_shared/lab/index.ts'

const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']
type Result = { status: number; body: Record<string, unknown> }
const forbidden: Result = { status: 403, body: { error: 'Adventure Lab is not available for this account' } }
const allowed = (email: string): boolean => LAB_EMAILS.includes(email.toLowerCase())

type Row = Record<string, unknown>
const idMap = (rows: unknown, key = 'name'): Record<string, string> =>
  Object.fromEntries(((rows ?? []) as Row[]).map((r) => [String(r.id), String(r[key] ?? '')]))

/** Node keys the party actually opened, via the beats instantiated from them. */
async function playedNodes(service: SupabaseClient, adventureId: string, nodes: Row[]): Promise<string[]> {
  if (nodes.length === 0) return []
  const { data: loops } = await service.from('core_loops').select('id').eq('adventure_id', adventureId)
  const loopIds = ((loops ?? []) as Row[]).map((l) => String(l.id))
  if (loopIds.length === 0) return []
  const { data: beats } = await service.from('beats').select('node_id').in('core_loop_id', loopIds)
  const usedIds = new Set(((beats ?? []) as Row[]).map((b) => String(b.node_id ?? '')).filter(Boolean))
  return nodes.filter((n) => usedIds.has(String(n.id))).map((n) => String(n.key))
}

export async function labInspect(service: SupabaseClient, adventureId: string, userEmail: string): Promise<Result> {
  if (!allowed(userEmail)) return forbidden
  if (!adventureId) return { status: 400, body: { error: 'adventure_id required' } }

  const [
    events, npcs, objectives, locations, ingredients, chapters, encounters, endings, stateRow,
    nodes, personalSlots,
  ] = await Promise.all([
    service.from('event_log').select('id, type, payload, created_at').eq('adventure_id', adventureId).order('id').limit(3000),
    service.from('npcs').select('id, name, role, initial_state').eq('adventure_id', adventureId),
    service.from('objectives').select('id, index, title, reveal_state').eq('adventure_id', adventureId),
    service.from('locations').select('id, name').eq('adventure_id', adventureId),
    service.from('ingredients').select('id, type, reveals, content, discovered').eq('adventure_id', adventureId),
    service.from('chapters').select('index, title, status').eq('adventure_id', adventureId),
    service.from('encounters').select('type, spec').eq('adventure_id', adventureId),
    service.from('endings').select('index, title, tone, status').eq('adventure_id', adventureId),
    service.from('adventure_state').select('state').eq('adventure_id', adventureId).maybeSingle(),
    service.from('story_nodes').select('id, key, kind, role, label, affordances, transitions')
      .eq('adventure_id', adventureId).order('key'),
    service.from('personal_slots').select('key, objective_template').eq('adventure_id', adventureId),
  ])
  if (events.error) return { status: 500, body: { error: events.error.message } }

  const ctx: ExplainContext = {
    npcs: idMap(npcs.data),
    objectives: idMap(objectives.data, 'title'),
    locations: idMap(locations.data),
    ingredients: Object.fromEntries(((ingredients.data ?? []) as Row[]).map((r) => {
      const content = (r.content ?? {}) as Row
      return [String(r.id), String(r.reveals || content.text || '')]
    })),
    characters: {},
  }
  const playthrough = buildPlaythrough((events.data ?? []) as unknown as PlayEvent[], ctx)

  const state = (stateRow.data?.state ?? {}) as Row
  const scene = (state.scene ?? {}) as Row
  const facts = (((state.dm ?? {}) as Row).facts ?? {}) as Row

  // The player-facing transcript: the rendered dialogue buffer (what the table actually saw),
  // annotated for fallback/duplicate lines and correlated to the Logs turn that produced each
  // line (so a click can jump there). Complete for one-shots (the buffer holds ~100 lines).
  const anchors: NarrationAnchor[] = []
  for (const turn of playthrough.turns) {
    for (const e of turn.raw) {
      if (e.type === 'narration_published' || e.type === 'say' || e.type === 'intent_submitted') {
        const text = (e.payload as Row).text
        if (typeof text === 'string' && text) anchors.push({ turnIndex: turn.index, text: narrationKey(text) })
      }
    }
  }
  const dialogue = (state.dialogue ?? {}) as Row
  const lines = (Array.isArray(dialogue.lines) ? dialogue.lines : []) as Row[]
  const narration = annotateNarration(
    lines.map((l) => ({ speaker: (l.speaker as string) ?? null, text: String(l.text ?? '') })),
    anchors,
  )

  // The authored guide with a live overlay (npc states, current location, objective/clue progress).
  const guide = buildGuideView({
    chapters: (chapters.data ?? []) as unknown as GuideInput['chapters'],
    objectives: (objectives.data ?? []) as unknown as GuideInput['objectives'],
    npcs: (npcs.data ?? []) as unknown as GuideInput['npcs'],
    locations: (locations.data ?? []) as unknown as GuideInput['locations'],
    encounters: (encounters.data ?? []) as unknown as GuideInput['encounters'],
    endings: (endings.data ?? []) as unknown as GuideInput['endings'],
    ingredients: (ingredients.data ?? []) as unknown as GuideInput['ingredients'],
    npcStates: (facts.npcStates ?? {}) as Record<string, string>,
    currentLocationId: (scene.locationId as string) ?? null,
    nodes: (nodes.data ?? []) as unknown as GuideInput['nodes'],
    // Which authored nodes actually got played - beats.node_id is the record. `beat_opened`
    // events carry node_key too, but the beat rows survive event-log truncation.
    playedNodeKeys: await playedNodes(service, adventureId, (nodes.data ?? []) as Row[]),
    personalSlots: (personalSlots.data ?? []) as unknown as GuideInput['personalSlots'],
  })

  return {
    status: 200,
    body: {
      turns: playthrough.turns, issues: playthrough.issues, eventCount: playthrough.eventCount, narration, guide,
    } as unknown as Record<string, unknown>,
  }
}

export async function labList(service: SupabaseClient, userId: string, userEmail: string, scope: string): Promise<Result> {
  if (!allowed(userEmail)) return forbidden

  let advQuery = service
    .from('adventures')
    .select('id, title, creator_id, mode, type, status, created_at, updated_at')
    .in('status', ['active', 'completed'])
    .order('updated_at', { ascending: false })
    .limit(200)
  if (scope !== 'all') advQuery = advQuery.eq('creator_id', userId)

  const [runsRes, advRes] = await Promise.all([
    service.from('lab_runs').select('id, status, config, adventure_id, spent_usd, created_at')
      .order('created_at', { ascending: false }).limit(100),
    advQuery,
  ])

  const runs = (runsRes.data ?? []) as Row[]
  const testAdvIds = new Set(runs.map((r) => r.adventure_id).filter(Boolean).map(String))
  const entries: Row[] = []

  for (const r of runs) {
    const config = (r.config ?? {}) as Row
    const plot = (config.plot ?? {}) as Row
    entries.push({
      kind: 'test', runId: r.id, adventureId: r.adventure_id ?? null,
      title: plot.title ?? (r.adventure_id ? 'Replay' : 'Run'),
      status: r.status, spentUsd: Number(r.spent_usd ?? 0), createdAt: r.created_at,
      quality: config.quality ?? null, partySize: config.party_size ?? null,
    })
  }
  for (const a of (advRes.data ?? []) as Row[]) {
    if (testAdvIds.has(String(a.id))) continue // already listed as its test run
    entries.push({
      kind: 'real', runId: null, adventureId: a.id,
      title: a.title || 'Untitled adventure',
      status: a.status, spentUsd: 0, createdAt: a.updated_at ?? a.created_at,
      quality: null, partySize: null,
    })
  }
  entries.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
  return { status: 200, body: { runs: entries } }
}
