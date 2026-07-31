// Phase 4 (F05 + F06 SS6) + Phase 5 (F07 + F10): the Session Manager and Adventure Manager in
// one seat. Lobby membership, character locking, session lifecycle, checkpoints, role-filtered
// resync, move intents, the scripted demo driver, and - since Phase 5 - the live intent
// pipeline (router, Adjudicator, NPC dialogue, proposals, pending-check lifecycle). Every
// state mutation is service-role and server-validated; this function is the one writer.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import { idleNudgeAction } from './beats.ts'
import { combatAction, liveCombat } from './combat-turn.ts'
import { hintAction } from './hints.ts'
import { debugUsage } from './debug.ts'
import { labInspect, labList } from './lab-inspect.ts'
import { playerIntent } from './intent.ts'
import { flushParkedTails, runStoryProgressTail } from './progress.ts'
import { endSession, manualCheckpoint, restoreCheckpoint, startSession } from './lifecycle.ts'
import { activate, admit, join, leave, pickCharacter, regenInvite, setReady } from './membership.ts'
import { narrateNext } from './narration.ts'
import { reviewDecide } from './npc-dialogue.ts'
import { createGenericNpc, endEncounter, startSocial } from './social-staging.ts'
import { decideProposal } from './proposals.ts'
import { claimAssist, resolvePending, rollPending } from './prompts.ts'
import { replayControl } from './replay.ts'
import { demoStep, moveIntent, resync, setScene } from './state.ts'
import { loadState, resetRequestCaches, takeStatePerf } from './util.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type ActionResult = { status: number; body: Record<string, unknown> }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Before anything reads: a Deno isolate is reused between requests, so a per-request cache that
  // is not cleared HERE becomes a cross-turn cache. See resetRequestCaches in util.ts.
  resetRequestCaches()
  const requestStartedAt = Date.now()
  let perfAction = 'unknown'
  let perfAdventureId = ''
  let perfService: SupabaseClient | null = null

  try {
    const authHeader = req.headers.get('Authorization') ?? ''

    // Internal continuation (service-role only): the story-progress pass hands its agent-heavy
    // tail to a FRESH worker, because WORKER_RESOURCE_LIMIT is a per-worker ceiling that killed
    // ~19% of player turns when the whole chain ran in one invocation (playtest 2026-07-20).
    if (authHeader.replace(/^Bearer\s+/i, '') === SUPABASE_SERVICE_ROLE_KEY) {
      const internalBody = await req.json()
      if (internalBody.action !== 'story_progress_tail') {
        return json(400, { error: 'Unsupported internal action' })
      }
      const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      const { data: adventure } = await service
        .from('adventures')
        .select('id, creator_id, demo, mode')
        .eq('id', String(internalBody.adventure_id ?? ''))
        .maybeSingle()
      if (!adventure) return json(404, { error: 'Adventure not found' })
      await runStoryProgressTail(service, {
        service,
        adventureId: adventure.id as string,
        creatorId: adventure.creator_id as string,
        demo: Boolean(adventure.demo),
        mode: adventure.mode as 'full_ai' | 'assist' | null,
      }, String(internalBody.session_id ?? ''), {
        // The head's context, carried across the worker boundary (2026-07-27). This branch is
        // service-role-gated above, so trusting these adds no surface. A kick from an older bundle
        // omits them and they read false - one turn of the pre-fix behaviour during a deploy, which
        // is strictly better than the row-scan heuristic this replaced.
        objectiveJustCompleted: internalBody.objective_just_completed === true,
        questJustCompleted: internalBody.quest_just_completed === true,
        recognitionRung: typeof internalBody.recognition_rung === 'number'
          ? internalBody.recognition_rung
          : null,
      })
      return json(200, { ok: true, resolved: 'story_progress_tail' })
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json(401, { error: 'Invalid or expired session' })
    const userId = userData.user.id

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const body = await req.json()
    const action: string = body.action
    const adventureId: string = body.adventure_id
    perfAction = action
    perfAdventureId = adventureId
    perfService = service

    const requireAdventure = (): ActionResult | null =>
      adventureId ? null : { status: 400, body: { error: 'adventure_id required' } }

    let result: ActionResult
    switch (action) {
      case 'activate':
        result = requireAdventure() ?? (await activate(service, adventureId, userId))
        break
      case 'join':
        result = body.invite_code
          ? await join(service, String(body.invite_code), userId)
          : { status: 400, body: { error: 'invite_code required' } }
        break
      case 'pick_character':
        result =
          requireAdventure() ??
          (await pickCharacter(service, adventureId, userId, body.character_id ? String(body.character_id) : null))
        break
      case 'ready':
        result = requireAdventure() ?? (await setReady(service, adventureId, userId, Boolean(body.ready)))
        break
      case 'admit':
        result =
          requireAdventure() ??
          (body.member_id
            ? await admit(service, adventureId, userId, String(body.member_id))
            : { status: 400, body: { error: 'member_id required' } })
        break
      case 'leave':
        result = requireAdventure() ?? (await leave(service, adventureId, userId))
        break
      case 'regen_invite':
        result = requireAdventure() ?? (await regenInvite(service, adventureId, userId))
        break
      case 'start_session':
        result = requireAdventure() ?? (await startSession(service, adventureId, userId))
        break
      case 'end_session':
        result = requireAdventure() ?? (await endSession(service, adventureId, userId))
        break
      case 'checkpoint':
        result =
          requireAdventure() ??
          (await manualCheckpoint(service, adventureId, userId, body.label ? String(body.label) : undefined))
        break
      case 'restore_checkpoint':
        result = body.checkpoint_id
          ? await restoreCheckpoint(service, String(body.checkpoint_id), userId)
          : { status: 400, body: { error: 'checkpoint_id required' } }
        break
      case 'resync':
        result = requireAdventure() ?? (await resync(service, adventureId, userId))
        break
      // A token drag. While an engine fight is live it must go THROUGH the engine - the legacy
      // path writes state.combat directly, which was the whole truth about where tokens are until
      // an engine started holding the same positions, and is a silent desync now. Dispatching here
      // (rather than inside moveIntent) keeps state.ts free of the combat chain: combat-turn.ts
      // reaches encounters.ts, which reaches back to state.ts through entry.ts.
      case 'move_intent': {
        const missing = requireAdventure()
        if (missing) { result = missing; break }
        if (!body.token_id || !body.to) {
          result = { status: 400, body: { error: 'token_id and to required' } }
          break
        }
        const to = { x: Number(body.to.x), y: Number(body.to.y) }
        result = liveCombat((await loadState(service, adventureId)).state)
          ? await combatAction(service, adventureId, userId, {
              token_id: String(body.token_id),
              combat_action: { type: 'move', to: [to.x, to.y] },
            })
          : await moveIntent(service, adventureId, userId, String(body.token_id), to)
        break
      }
      case 'combat_action':
        result = requireAdventure() ?? (await combatAction(service, adventureId, userId, body))
        break
      case 'set_scene':
        result =
          requireAdventure() ??
          (await setScene(service, adventureId, userId, {
            location_id: body.location_id ? String(body.location_id) : undefined,
            active_visual: body.active_visual,
            music_track: body.music_track === undefined ? undefined : body.music_track,
          }))
        break
      case 'demo_step':
        result = requireAdventure() ?? (await demoStep(service, adventureId, userId))
        break
      case 'player_intent':
        result = requireAdventure() ?? (await playerIntent(service, adventureId, userId, body))
        break
      case 'idle_nudge':
        result = requireAdventure() ?? (await idleNudgeAction(service, adventureId, userId))
        break
      case 'hint':
        result = requireAdventure() ?? (await hintAction(service, adventureId, userId, body.requested === true))
        break
      case 'roll_pending':
        result =
          requireAdventure() ??
          (body.prompt_id
            ? await rollPending(
                service, adventureId, userId, String(body.prompt_id),
                body.skill ? String(body.skill) : undefined,
              )
            : { status: 400, body: { error: 'prompt_id required' } })
        break
      case 'claim_assist':
        result =
          requireAdventure() ??
          (body.prompt_id
            ? await claimAssist(service, adventureId, userId, String(body.prompt_id))
            : { status: 400, body: { error: 'prompt_id required' } })
        break
      case 'resolve_pending':
        result =
          requireAdventure() ??
          (body.prompt_id
            ? await resolvePending(service, adventureId, userId, String(body.prompt_id))
            : { status: 400, body: { error: 'prompt_id required' } })
        break
      case 'narrate_next':
        result =
          requireAdventure() ??
          (await narrateNext(service, adventureId, userId, body.prompt ? String(body.prompt) : undefined))
        break
      case 'start_social':
        result =
          requireAdventure() ??
          (await startSocial(service, adventureId, userId, Array.isArray(body.npc_ids) ? body.npc_ids.map(String) : []))
        break
      case 'end_encounter':
        result = requireAdventure() ?? (await endEncounter(service, adventureId, userId))
        break
      case 'review_decide':
        result = requireAdventure() ?? (await reviewDecide(service, adventureId, userId, body))
        break
      case 'generic_npc':
        result =
          requireAdventure() ?? (await createGenericNpc(service, adventureId, userId, String(body.role_hint ?? '')))
        break
      case 'debug_usage':
        result = requireAdventure() ?? (await debugUsage(service, adventureId, userData.user.email ?? ''))
        break
      case 'lab_list':
        result = await labList(service, userId, userData.user.email ?? '', String(body.scope ?? 'mine'))
        break
      case 'lab_inspect':
        result = requireAdventure() ?? (await labInspect(service, adventureId, userData.user.email ?? ''))
        break
      case 'replay_control':
        result =
          requireAdventure() ??
          (await replayControl(service, adventureId, userId, userData.user.email ?? '', body))
        break
      case 'decide_proposal':
        result =
          requireAdventure() ??
          (body.proposal_id && ['accepted', 'rejected', 'edited'].includes(String(body.verdict))
            ? await decideProposal(
                service, adventureId, userId, String(body.proposal_id),
                String(body.verdict) as 'accepted' | 'rejected' | 'edited',
                (body.edit_diff ?? null) as never,
              )
            : { status: 400, body: { error: 'proposal_id and verdict (accepted|rejected|edited) required' } })
        break
      default:
        result = { status: 400, body: { error: `Unknown action: ${action}` } }
    }
    return json(result.status, result.body)
  } catch (err) {
    console.error(err)
    return json(500, { error: err instanceof Error ? err.message : 'Internal error' })
  } finally {
    // THE TAIL STARTS WHEN THE REQUEST STOPS TALKING (2026-07-29).
    //
    // The story-progress head parks its tail instead of kicking it (see parkTail), because the
    // head returning is not the request being over - the caller goes on to narrate, and the tail
    // worker cannot see it. This is the one place that knows the request is genuinely done.
    //
    // In `finally`, so a tail is never lost to a thrown action: the tail carries the beat re-plan
    // and the ending scores, and dropping it on an error would silently stall the story rather
    // than fail loudly. And in `finally` rather than after the `return`, because kickTail
    // registers `EdgeRuntime.waitUntil` and must do so while this worker is still alive.
    //
    // Never throws into the response: a failed kick is already logged as `tail_kick_failed`.
    try {
      flushParkedTails()
    } catch (err) {
      console.error('tail flush failed', err)
    }

    // TEMPORARY state-I/O accounting - see takeStatePerf in util.ts, and delete both together.
    // One extra event_log write per request, which is itself the cheap kind of write this exists
    // to compare against. Fire-and-forget and fully swallowed: an instrument must never be able
    // to fail the request it is measuring.
    const perf = takeStatePerf()
    if (perfService && perfAdventureId && perf.reads + perf.writes > 0) {
      perfService
        .from('event_log')
        .insert({
          adventure_id: perfAdventureId,
          session_id: null,
          type: 'perf_state_io',
          payload: {
            action: perfAction,
            request_ms: Date.now() - requestStartedAt,
            state_reads: perf.reads,
            state_read_ms: perf.readMs,
            state_writes: perf.writes,
            state_write_ms: perf.writeMs,
            write_conflicts: perf.conflicts,
            state_bytes: perf.bytes,
          },
        })
        .then(({ error }) => {
          if (error) console.error('perf sample insert failed', error)
        })
    }
  }
})
