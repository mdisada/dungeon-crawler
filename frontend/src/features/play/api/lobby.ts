// Read-side lobby queries (RLS member policies). Writes live in session.ts.

import { supabase } from '@/lib/supabase'

import type { LobbyMember, MemberAdventure, PickableCharacter } from '../types'

export async function getMemberAdventure(adventureId: string): Promise<MemberAdventure | null> {
  const { data, error } = await supabase
    .from('member_adventures')
    .select('*')
    .eq('id', adventureId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    title: data.title,
    status: data.status,
    mode: data.mode,
    type: data.type,
    minPlayers: data.min_players,
    maxPlayers: data.max_players,
    inviteCode: data.invite_code,
    creatorId: data.creator_id,
    isDemo: data.demo,
    createdAt: data.created_at,
  }
}

export async function listMemberAdventures(): Promise<MemberAdventure[]> {
  const { data, error } = await supabase
    .from('member_adventures')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    mode: row.mode,
    type: row.type,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    inviteCode: row.invite_code,
    creatorId: row.creator_id,
    isDemo: row.demo,
    createdAt: row.created_at,
  }))
}

export async function listLobbyMembers(adventureId: string): Promise<LobbyMember[]> {
  const { data, error } = await supabase
    .from('adventure_members')
    .select('id, user_id, role, character_id, ready, spectator, characters (name, level, class_key)')
    .eq('adventure_id', adventureId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []).map((row) => {
    const character = Array.isArray(row.characters) ? row.characters[0] : row.characters
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      characterId: row.character_id,
      ready: row.ready,
      spectator: row.spectator,
      characterName: character?.name ?? null,
      characterLevel: character?.level ?? null,
      characterClass: character?.class_key ?? null,
      online: false,
    }
  })
}

export async function listOwnCompleteCharacters(): Promise<PickableCharacter[]> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, level, class_key, locked_adventure_id')
    .eq('user_id', userId)
    .eq('is_complete', true)
    .order('name')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    level: row.level,
    classKey: row.class_key,
    lockedAdventureId: row.locked_adventure_id,
  }))
}
