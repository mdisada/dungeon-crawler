import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import {
  ABILITY_KEYS, abilityModifier, applyAbilityBonuses, proficiencyBonus,
  savingThrowModifier, SKILL_ABILITY, skillModifier,
} from '@rules/character'
import type { AbilityKey, AbilityScores, SkillName } from '@rules/character'

export interface CharacterSheet {
  id: string
  name: string
  level: number
  className: string
  raceName: string
  alignment: string | null
  xp: number
  abilities: AbilityScores
  modifiers: Record<AbilityKey, number>
  proficiencyBonus: number
  saves: { key: AbilityKey; modifier: number; proficient: boolean }[]
  skills: { name: SkillName; modifier: number; proficient: boolean }[]
  speed: string | null
  initiativeMod: number
  equipment: string[]
  personality: Record<string, string>
  freeformText: string
  proficiencies: string[]
  imageUrl: string | null
}

type SheetState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sheet: CharacterSheet }

/** Loads + derives the sidebar character sheet (party RLS read; math from @rules/character). */
export function useCharacterSheet(characterId: string | null): SheetState {
  const [state, setState] = useState<SheetState>({ status: 'loading' })

  useEffect(() => {
    if (!characterId) return
    let cancelled = false
    async function load() {
      const { data: row, error } = await supabase
        .from('characters')
        .select('*')
        .eq('id', characterId)
        .maybeSingle()
      if (error || !row) throw new Error(error?.message ?? 'Character not found')

      const [classRes, raceRes] = await Promise.all([
        row.class_key
          ? supabase.from('srd_classes').select('name, data').eq('key', row.class_key).maybeSingle()
          : Promise.resolve({ data: null }),
        row.race_key
          ? supabase.from('srd_races').select('name, speed').eq('key', row.race_key).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const classData = (classRes.data?.data ?? {}) as { saving_throws?: (string | { name: string })[] }
      const saveProfs = new Set(
        (classData.saving_throws ?? [])
          .map((s) => (typeof s === 'string' ? s : s.name))
          .map((name) => name.slice(0, 3).toLowerCase()),
      )

      const abilities = applyAbilityBonuses(
        row.abilities as AbilityScores,
        (row.ability_bonuses ?? {}) as Partial<Record<AbilityKey, number>>,
      )
      const pb = proficiencyBonus(row.level)
      const modifiers = Object.fromEntries(
        ABILITY_KEYS.map((key) => [key, abilityModifier(abilities[key])]),
      ) as Record<AbilityKey, number>
      const skillProfs = new Set((row.skill_proficiencies ?? []) as string[])

      const equipment = ((row.equipment ?? []) as ({ name?: string } | string)[]).map((item) =>
        typeof item === 'string' ? item : (item.name ?? ''),
      )
      const images = (row.images ?? {}) as Record<string, unknown>
      const imageCandidate =
        images.portraitUrl ?? images.portrait ?? images.avatarUrl ?? images.avatar ?? images.fullbodyUrl ?? null

      const sheet: CharacterSheet = {
        id: row.id,
        name: row.name,
        level: row.level,
        className: classRes.data?.name ?? row.class_key ?? '',
        raceName: raceRes.data?.name ?? row.race_key ?? '',
        alignment: row.alignment,
        xp: row.xp,
        abilities,
        modifiers,
        proficiencyBonus: pb,
        saves: ABILITY_KEYS.map((key) => ({
          key,
          proficient: saveProfs.has(key),
          modifier: savingThrowModifier(modifiers[key], saveProfs.has(key), pb),
        })),
        skills: (Object.keys(SKILL_ABILITY) as SkillName[]).map((name) => ({
          name,
          proficient: skillProfs.has(name),
          modifier: skillModifier(modifiers[SKILL_ABILITY[name]], skillProfs.has(name), pb),
        })),
        speed: raceRes.data?.speed ?? null,
        initiativeMod: modifiers.dex,
        equipment,
        personality: (row.personality ?? {}) as Record<string, string>,
        freeformText: row.freeform_text ?? '',
        proficiencies: [...((row.skill_proficiencies ?? []) as string[]), ...((row.tool_proficiencies ?? []) as string[])],
        imageUrl: typeof imageCandidate === 'string' ? imageCandidate : null,
      }
      if (!cancelled) setState({ status: 'ready', sheet })
    }
    load().catch((err: unknown) => {
      if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load character' })
    })
    return () => {
      cancelled = true
    }
  }, [characterId])

  if (!characterId) return { status: 'error', message: 'No character picked' }
  return state
}
