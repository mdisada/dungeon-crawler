// Phase 4 (F05 + F06 SS6): the Session Manager. Lobby membership, character locking, session
// lifecycle, checkpoints, role-filtered resync, move intents, and the scripted demo driver.
// Every state mutation is service-role and server-validated - RLS gives clients read access
// only, so this function is the one writer (F07's Adventure Manager inherits the seat).
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import { endSession, manualCheckpoint, restoreCheckpoint, startSession } from './lifecycle.ts'
import { activate, admit, join, leave, pickCharacter, regenInvite, setReady } from './membership.ts'
import { demoStep, moveIntent, resync, setScene } from './state.ts'

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

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
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
      case 'move_intent':
        result =
          requireAdventure() ??
          (body.token_id && body.to
            ? await moveIntent(service, adventureId, userId, String(body.token_id), {
                x: Number(body.to.x),
                y: Number(body.to.y),
              })
            : { status: 400, body: { error: 'token_id and to required' } })
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
      default:
        result = { status: 400, body: { error: `Unknown action: ${action}` } }
    }
    return json(result.status, result.body)
  } catch (err) {
    console.error(err)
    return json(500, { error: err instanceof Error ? err.message : 'Internal error' })
  }
})
