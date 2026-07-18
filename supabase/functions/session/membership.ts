// F05 SS2-3: membership writes. All go through the service role so capacity caps, character
// locking, and spectator gating are enforced here, atomically, not in the UI.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { computePartyProfile } from '../_shared/state/index.ts'
import type { Json } from '../_shared/state/index.ts'
import { ADVENTURE_COLUMNS, assertOk, broadcast, ensureStateRow, loadContext } from './util.ts'
import type { AdventureRow } from './util.ts'

/** Recomputes adventures.party_profile from the currently picked characters (F05 SS3). */
export async function recomputePartyProfile(service: SupabaseClient, adventureId: string): Promise<void> {
  const { data: members, error } = await service
    .from('adventure_members')
    .select('character_id, spectator')
    .eq('adventure_id', adventureId)
  assertOk(error, 'members load failed')
  const characterIds = (members ?? [])
    .filter((m) => !m.spectator && m.character_id)
    .map((m) => m.character_id as string)

  let profile = computePartyProfile([])
  if (characterIds.length > 0) {
    const { data: chars, error: charsError } = await service
      .from('characters')
      .select('id, name, class_key, level, skill_proficiencies, tool_proficiencies')
      .in('id', characterIds)
    assertOk(charsError, 'characters load failed')
    profile = computePartyProfile(
      (chars ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        classKey: c.class_key,
        level: c.level,
        skillProficiencies: c.skill_proficiencies ?? [],
        toolProficiencies: c.tool_proficiencies ?? [],
      })),
    )
  }
  const { error: writeError } = await service
    .from('adventures')
    .update({ party_profile: profile as unknown as Json, updated_at: new Date().toISOString() })
    .eq('id', adventureId)
  assertOk(writeError, 'party profile write failed')
}

/** Nudges every lobby client to refetch members (writes are server-side, so no postgres_changes). */
async function notifyLobby(adventureId: string): Promise<void> {
  await broadcast(`lobby:${adventureId}`, 'members_changed', {})
}

/** Creator opens a guide_ready adventure for play: membership row + state bootstrap. */
export async function activate(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx || !ctx.isCreator) return { status: 404, body: { error: 'Adventure not found' } }
  const { adventure } = ctx
  if (adventure.status !== 'guide_ready' && adventure.status !== 'active') {
    return { status: 409, body: { error: `Cannot activate a ${adventure.status} adventure` } }
  }

  // In assist mode the creator DMs (dm_user_id defaults to them); in full-AI they play.
  const role = adventure.mode === 'assist' ? 'dm' : 'player'
  const { error: memberError } = await service
    .from('adventure_members')
    .upsert(
      { adventure_id: adventureId, user_id: userId, role },
      { onConflict: 'adventure_id,user_id', ignoreDuplicates: true },
    )
  assertOk(memberError, 'creator membership failed')

  let title = adventure.title
  if (!title) {
    const { data: chapter } = await service
      .from('chapters')
      .select('title')
      .eq('adventure_id', adventureId)
      .order('index')
      .limit(1)
      .maybeSingle()
    title = chapter?.title || 'Untitled adventure'
  }

  const { error: updateError } = await service
    .from('adventures')
    .update({
      status: 'active',
      title,
      dm_user_id: adventure.mode === 'assist' ? (adventure.dm_user_id ?? userId) : adventure.dm_user_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adventureId)
  assertOk(updateError, 'activation failed')

  await ensureStateRow(service, adventureId)
  return { status: 200, body: { ok: true, title } }
}

/** Join via invite link (F05 SS2): capped at max_players, DM excluded from the count. */
export async function join(service: SupabaseClient, inviteCode: string, userId: string) {
  const { data: adventure, error } = await service
    .from('adventures')
    .select(ADVENTURE_COLUMNS)
    .eq('invite_code', inviteCode)
    .maybeSingle()
  assertOk(error, 'invite lookup failed')
  if (!adventure) return { status: 404, body: { error: 'Invalid invite link' } }
  const adv = adventure as AdventureRow
  if (adv.status !== 'active') return { status: 409, body: { error: 'This adventure is not open for players' } }

  const existing = await loadContext(service, adv.id, userId)
  if (existing?.member || existing?.isCreator) {
    return { status: 200, body: { ok: true, adventure_id: adv.id, already_member: true } }
  }

  const { count, error: countError } = await service
    .from('adventure_members')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', adv.id)
    .eq('role', 'player')
  assertOk(countError, 'capacity check failed')
  if ((count ?? 0) >= adv.max_players) return { status: 409, body: { error: 'This adventure is full' } }

  // Late joiners while a session is running spectate until the DM admits them (F05 SS3).
  const { data: openSession } = await service
    .from('sessions')
    .select('id')
    .eq('adventure_id', adv.id)
    .is('ended_at', null)
    .maybeSingle()

  const { error: insertError } = await service.from('adventure_members').insert({
    adventure_id: adv.id,
    user_id: userId,
    role: 'player',
    spectator: openSession !== null,
  })
  // The unique(adventure_id,user_id) constraint absorbs a double-click race.
  if (insertError && !insertError.message.includes('duplicate')) assertOk(insertError, 'join failed')

  await notifyLobby(adv.id)
  return { status: 200, body: { ok: true, adventure_id: adv.id, spectator: openSession !== null } }
}

/** Atomic character pick + lock (F05 SS3): one character, one active adventure. */
export async function pickCharacter(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  characterId: string | null,
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember || !ctx.member) return { status: 404, body: { error: 'Not a member of this adventure' } }

  // Release the previous pick when switching or clearing.
  if (ctx.member.character_id && ctx.member.character_id !== characterId) {
    await service
      .from('characters')
      .update({ locked_adventure_id: null })
      .eq('id', ctx.member.character_id)
      .eq('locked_adventure_id', adventureId)
  }

  let warning: string | null = null
  if (characterId) {
    // Single guarded UPDATE: succeeds only if the caller owns a complete character that is
    // unlocked or already locked to this adventure - the locking acceptance criterion.
    const { data: locked, error } = await service
      .from('characters')
      .update({ locked_adventure_id: adventureId })
      .eq('id', characterId)
      .eq('user_id', userId)
      .eq('is_complete', true)
      .or(`locked_adventure_id.is.null,locked_adventure_id.eq.${adventureId}`)
      .select('id, level')
    assertOk(error, 'character lock failed')
    if (!locked || locked.length === 0) {
      return { status: 409, body: { error: 'Character unavailable (incomplete, not yours, or locked to another adventure)' } }
    }
    // Guide-time party assumption is level 1 + chapter index (Phase 3b decision); the lobby
    // warning is informational and the DM can waive it (F05 SS3).
    if (locked[0].level !== 1) warning = `Level ${locked[0].level} deviates from the adventure's expected starting level (1)`
  }

  const { error: memberError } = await service
    .from('adventure_members')
    .update({ character_id: characterId, ready: false })
    .eq('id', ctx.member.id)
  assertOk(memberError, 'member update failed')

  await recomputePartyProfile(service, adventureId)
  await notifyLobby(adventureId)
  return { status: 200, body: { ok: true, warning } }
}

export async function setReady(service: SupabaseClient, adventureId: string, userId: string, ready: boolean) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.member) return { status: 404, body: { error: 'Not a member of this adventure' } }
  if (ready && ctx.member.role === 'player' && !ctx.member.character_id) {
    return { status: 409, body: { error: 'Pick a character before readying up' } }
  }
  const { error } = await service.from('adventure_members').update({ ready }).eq('id', ctx.member.id)
  assertOk(error, 'ready update failed')
  await notifyLobby(adventureId)
  return { status: 200, body: { ok: true } }
}

/** DM admits a spectating late joiner into the party (F05 SS3). */
export async function admit(service: SupabaseClient, adventureId: string, userId: string, memberId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can admit players' } }
  const { data, error } = await service
    .from('adventure_members')
    .update({ spectator: false })
    .eq('id', memberId)
    .eq('adventure_id', adventureId)
    .select('id')
  assertOk(error, 'admit failed')
  if (!data || data.length === 0) return { status: 404, body: { error: 'Member not found' } }
  await recomputePartyProfile(service, adventureId)
  await notifyLobby(adventureId)
  return { status: 200, body: { ok: true } }
}

export async function leave(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.member) return { status: 404, body: { error: 'Not a member of this adventure' } }
  if (ctx.member.character_id) {
    await service
      .from('characters')
      .update({ locked_adventure_id: null })
      .eq('id', ctx.member.character_id)
      .eq('locked_adventure_id', adventureId)
  }
  const { error } = await service.from('adventure_members').delete().eq('id', ctx.member.id)
  assertOk(error, 'leave failed')
  await recomputePartyProfile(service, adventureId)
  await notifyLobby(adventureId)
  return { status: 200, body: { ok: true } }
}

/** New invite code invalidates every previously shared link (F05 SS2 "regenerable"). */
export async function regenInvite(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can regenerate the invite' } }
  const code = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const { error } = await service.from('adventures').update({ invite_code: code }).eq('id', adventureId)
  assertOk(error, 'invite regeneration failed')
  return { status: 200, body: { ok: true, invite_code: code } }
}
