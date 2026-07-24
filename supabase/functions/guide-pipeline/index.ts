// F04 SS2: the Adventure Guide generation pipeline. Runs the seven stages as guide_jobs rows,
// one job per invocation, self-chaining via an internal service-role re-invocation ("kick").
// A stage failure pauses the queue with the error on the job row; `retry` resumes it. Also
// serves per-row regeneration (F04 SS7: human-edited rows get a pending_regen proposal, never
// an overwrite).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import {
  buildRegenEntityPrompt,
  type EndingRegenRefs,
  parseRegenEntity,
  REGEN_AGENT_ROLE,
  type RegenEntityType,
} from '../_shared/guide/regen-entity.ts'
import type { Json } from '../_shared/guide/types.ts'
import { generateParsed, processNextJob } from './runner.ts'
import { assertOk, syncSpineAtoms, type AdventureRow } from './util.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!

const REGEN_TABLES: Record<string, RegenEntityType> = {
  chapters: 'chapter',
  objectives: 'objective',
  npcs: 'npc',
  locations: 'location',
  endings: 'ending',
}

// Deletion order for a fresh start: leaves before parents (chapters cascade scenes/objectives).
const WIPE_TABLES = ['guide_jobs', 'guide_warnings', 'hooks', 'ingredients', 'coop_sets', 'encounters', 'endings', 'story_atoms', 'chapters', 'npcs', 'locations']

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined

/** Fire-and-forget self-invocation to process the next queued job. */
function kick(adventureId: string) {
  const request = fetch(`${SUPABASE_URL}/functions/v1/guide-pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'run', adventure_id: adventureId }),
  }).catch((err) => console.error('kick failed', err))
  const grace = new Promise((resolve) => setTimeout(resolve, 3000))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(Promise.race([request, grace]))
  }
}

async function requireOwnedAdventure(userClient: SupabaseClient, adventureId: string) {
  // Read through the caller's RLS: a row coming back proves ownership (creator-only policies).
  const { data, error } = await userClient
    .from('adventures')
    .select('id, creator_id, status, mode, type, plot_idea')
    .eq('id', adventureId)
    .maybeSingle()
  if (error || !data) return null
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const bearer = authHeader.replace(/^Bearer\s+/i, '')
    const isInternal = bearer === SUPABASE_SERVICE_ROLE_KEY
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const body = await req.json()
    const action: string = body.action

    if (action === 'run') {
      const adventureId: string = body.adventure_id
      if (!adventureId) return json(400, { error: 'adventure_id required' })
      if (!isInternal) {
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        })
        if (!(await requireOwnedAdventure(userClient, adventureId))) return json(404, { error: 'Adventure not found' })
      }
      const result = await processNextJob(service, OPENROUTER_API_KEY, adventureId)
      if (result === 'ran') kick(adventureId)
      return json(200, { result })
    }

    // Everything below is user-triggered.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json(401, { error: 'Invalid or expired session' })

    if (action === 'start') {
      const adventureId: string = body.adventure_id
      if (!adventureId) return json(400, { error: 'adventure_id required' })
      const adventure = await requireOwnedAdventure(userClient, adventureId)
      if (!adventure) return json(404, { error: 'Adventure not found' })
      if (!adventure.mode || !adventure.type || !adventure.plot_idea?.trim()) {
        return json(400, { error: 'Adventure draft is incomplete (mode, type and plot are required)' })
      }
      if (!['draft', 'generating', 'guide_ready'].includes(adventure.status)) {
        return json(409, { error: `Cannot regenerate a guide for a ${adventure.status} adventure` })
      }

      for (const table of WIPE_TABLES) {
        const { error } = await service.from(table).delete().eq('adventure_id', adventureId)
        assertOk(error, `${table} wipe failed`)
      }
      const { error: resetError } = await service
        .from('adventures')
        .update({ meta_loop: null, status: 'generating', updated_at: new Date().toISOString() })
        .eq('id', adventureId)
      assertOk(resetError, 'adventure reset failed')
      const { error: jobError } = await service
        .from('guide_jobs')
        .insert({ adventure_id: adventureId, stage: 1 })
      assertOk(jobError, 'stage-1 job insert failed')

      kick(adventureId)
      return json(202, { ok: true })
    }

    if (action === 'retry') {
      const jobId: string = body.job_id
      if (!jobId) return json(400, { error: 'job_id required' })
      const { data: job, error } = await service
        .from('guide_jobs')
        .select('id, adventure_id, status')
        .eq('id', jobId)
        .maybeSingle()
      assertOk(error, 'job load failed')
      if (!job || !(await requireOwnedAdventure(userClient, job.adventure_id))) {
        return json(404, { error: 'Job not found' })
      }
      if (job.status !== 'failed') return json(409, { error: 'Only failed jobs can be retried' })

      const { error: requeueError } = await service
        .from('guide_jobs')
        .update({ status: 'queued', error: null, started_at: null, finished_at: null })
        .eq('id', job.id)
      assertOk(requeueError, 'job requeue failed')
      kick(job.adventure_id)
      return json(202, { ok: true })
    }

    if (action === 'regenerate') {
      const table: string = body.table
      const id: string = body.id
      const type = REGEN_TABLES[table]
      if (!type || !id) return json(400, { error: 'table (chapters|objectives|npcs|locations) and id required' })

      // Read the row through the caller's RLS - doubles as the ownership check.
      const { data: row, error } = await userClient.from(table).select('*').eq('id', id).maybeSingle()
      if (error || !row) return json(404, { error: 'Row not found' })

      const { data: adventure, error: adventureError } = await service
        .from('adventures')
        .select('id, creator_id, plot_idea, mode, type, chapters_min, chapters_max, min_players, max_players, difficulty_setting, meta_loop, story_dials, status')
        .eq('id', row.adventure_id)
        .single()
      assertOk(adventureError, 'adventure load failed')
      const adv = adventure as AdventureRow

      // Ending regen needs the closed-vocabulary ref lists in stage-8 order (chapter->index for
      // objectives, created_at for NPCs) so signal numbers map back to the same rows.
      let endingRefs: EndingRegenRefs | undefined
      if (type === 'ending') {
        const [objRes, npcRes] = await Promise.all([
          service.from('objectives').select('id, chapter_id, index, title').eq('adventure_id', adv.id),
          service.from('npcs').select('id, name, role').eq('adventure_id', adv.id).order('created_at'),
        ])
        assertOk(objRes.error, 'ending regen objectives load failed')
        assertOk(npcRes.error, 'ending regen npcs load failed')
        const { data: chapterRows } = await service.from('chapters').select('id, index').eq('adventure_id', adv.id)
        const chapterNumber = new Map((chapterRows ?? []).map((c) => [c.id, c.index + 1]))
        const sortedObjectives = (objRes.data ?? []).sort(
          (a, b) =>
            (chapterNumber.get(a.chapter_id) ?? 0) - (chapterNumber.get(b.chapter_id) ?? 0) || a.index - b.index,
        )
        endingRefs = {
          objectives: sortedObjectives.map((o) => ({ id: o.id as string, label: o.title as string })),
          npcs: (npcRes.data ?? []).map((n) => ({ id: n.id as string, label: `${n.name}${n.role === 'boss' ? ' (boss)' : ''}` })),
          dials: (adv.story_dials ?? []).map((d) => ({ key: d.key, name: d.name })),
        }
      }

      let chapterTitle = ''
      let chapterArc = ''
      if (type === 'chapter') {
        chapterTitle = row.title
        chapterArc = row.arc_summary
      } else if (row.chapter_id) {
        const { data: chapter } = await service
          .from('chapters')
          .select('title, arc_summary')
          .eq('id', row.chapter_id)
          .maybeSingle()
        chapterTitle = chapter?.title ?? ''
        chapterArc = chapter?.arc_summary ?? ''
      }

      const current: Record<string, Json> =
        type === 'chapter'
          ? { title: row.title, arc_summary: row.arc_summary }
          : type === 'objective'
            ? { title: row.title, hidden_description: row.hidden_description, completion_predicates: row.completion_predicates }
            : type === 'npc'
              ? { name: row.name, role: row.role, personality: row.personality, faction: row.faction, description: row.description, image_prompt: row.image_prompt }
              : type === 'ending'
                ? { title: row.title, description: row.description, climax_summary: row.climax_summary, tone: row.tone, trigger_conditions: row.trigger_conditions }
                : { name: row.name, description: row.description, image_prompt: row.image_prompt }

      const prompt = buildRegenEntityPrompt(type, {
        premise: adv.meta_loop?.premise ?? adv.plot_idea,
        antagonist: adv.meta_loop?.antagonist ?? '',
        chapterTitle,
        chapterArc,
        entities: adv.meta_loop?.entities,
        endingRefs,
        current,
      })
      const fields = await generateParsed(
        service,
        OPENROUTER_API_KEY,
        adv,
        REGEN_AGENT_ROLE[type],
        prompt,
        (raw) => parseRegenEntity(type, raw, endingRefs),
      )

      if (row.human_edited) {
        const { error: proposeError } = await service.from(table).update({ pending_regen: fields }).eq('id', id)
        assertOk(proposeError, 'proposal write failed')
        return json(200, { result: 'proposed', fields })
      }
      const { error: applyError } = await service
        .from(table)
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
      assertOk(applyError, 'regen apply failed')
      // Objective regen may rewrite completion_predicates - keep the atom registry in step.
      if (table === 'objectives') await syncSpineAtoms(service, adventure.id)
      return json(200, { result: 'applied', fields })
    }

    return json(400, { error: `Unknown action: ${action}` })
  } catch (err) {
    console.error(err)
    return json(500, { error: err instanceof Error ? err.message : 'Internal error' })
  }
})
