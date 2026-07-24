// Story-encounter replay state (F09 SS11.1). Loads the user's authored combat encounters and, for
// a selected adventure, the context the SHARED initiator joins - then assembles the exact
// CombatManifest live play would build. Plain useState/useEffect per project convention.

import { useEffect, useMemo, useState } from 'react'

import { buildManifest } from '@rules/combat'
import type { CombatManifest, DifficultySetting, ManifestMapInput } from '@rules/combat'

import {
  listCombatEncounters, loadAdventureCombatContext,
} from '../api/encounters'
import type { AdventureCombatContext, CombatEncounterOption } from '../api/encounters'

export interface AdventureGroup {
  id: string
  title: string
  count: number
}

export function useEncounterReplay() {
  const [all, setAll] = useState<CombatEncounterOption[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const [adventureId, setAdventureIdRaw] = useState('')
  const [encounterId, setEncounterIdRaw] = useState('')
  const [bossOverride, setBossOverride] = useState<boolean | null>(null)

  const [context, setContext] = useState<AdventureCombatContext | null>(null)
  const [contextStatus, setContextStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    listCombatEncounters()
      .then((rows) => {
        if (cancelled) return
        setAll(rows)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Encounters failed to load')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The 'loading'/reset transition happens in setAdventureId (an event handler); the effect only
  // resolves the fetch, so it never calls setState synchronously in its body.
  useEffect(() => {
    if (!adventureId) return
    let cancelled = false
    loadAdventureCombatContext(adventureId)
      .then((ctx) => {
        if (cancelled) return
        setContext(ctx)
        setContextStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setContext(null)
        setContextStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [adventureId])

  const adventures = useMemo<AdventureGroup[]>(() => {
    const byId = new Map<string, AdventureGroup>()
    for (const enc of all) {
      const existing = byId.get(enc.adventureId)
      if (existing) existing.count += 1
      else byId.set(enc.adventureId, { id: enc.adventureId, title: enc.adventureTitle, count: 1 })
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title))
  }, [all])

  const encounters = useMemo(
    () => all.filter((e) => e.adventureId === adventureId),
    [all, adventureId],
  )
  const selectedEncounter = useMemo(
    () => encounters.find((e) => e.id === encounterId) ?? null,
    [encounters, encounterId],
  )

  // Boss is auto-included when this encounter names the adventure boss; the user can override.
  const autoBoss = useMemo(() => {
    if (!context?.boss || !selectedEncounter) return false
    const bossName = context.boss.name.trim().toLowerCase()
    return selectedEncounter.enemies.some((e) => e.name.trim().toLowerCase() === bossName)
  }, [context, selectedEncounter])
  const includeBoss = bossOverride ?? autoBoss

  function setAdventureId(id: string) {
    setAdventureIdRaw(id)
    setEncounterIdRaw('')
    setBossOverride(null)
    setContext(null)
    setContextStatus(id ? 'loading' : 'idle')
  }

  function setEncounterId(id: string) {
    setEncounterIdRaw(id)
    setBossOverride(null)
  }

  function assembleManifest(map: ManifestMapInput, difficultyOverride?: DifficultySetting): CombatManifest | null {
    if (!selectedEncounter || !context) return null
    return buildManifest({
      encounterId: selectedEncounter.id,
      enemies: selectedEncounter.enemies,
      npcs: context.npcs,
      party: context.party,
      map,
      bossNpcId: includeBoss && context.boss ? context.boss.id : null,
      baselinePreset: context.baselinePreset,
      difficultyOverride,
      beatSpec: selectedEncounter.outcomeAtoms.length > 0
        ? {
            label: selectedEncounter.summary.slice(0, 80) || 'Combat',
            stakes: '',
            onSuccess: selectedEncounter.outcomeAtoms,
            onPartial: [],
            onFailure: [],
          }
        : undefined,
    })
  }

  return {
    status,
    error,
    adventures,
    adventureId,
    setAdventureId,
    encounters,
    encounterId,
    setEncounterId,
    selectedEncounter,
    context,
    contextStatus,
    hasBoss: !!context?.boss,
    bossName: context?.boss?.name ?? null,
    includeBoss,
    setIncludeBoss: setBossOverride,
    partyCount: context?.party.length ?? 0,
    assembleManifest,
  }
}
