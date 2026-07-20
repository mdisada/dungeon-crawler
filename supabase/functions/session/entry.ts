// Entry mapping (encounter-states 4.1): the cutscene phase's single handler. While no
// encounter is open, every full-AI say/do lands here - the mapper classifies the reply as
// engaging the offered encounter, an off-script endeavor (ad-hoc micro-encounter via the
// Encounter Designer), or trivial color folded into the next cutscene block. Cutscene inputs
// never silently vanish, and nothing here writes progression - outcome maps own that.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import { runEntryMapper } from './agents.ts'
import type { AgentEnv, SceneEffects } from './agents.ts'
import { loadLoops } from './beats.ts'
import {
  handleChallengeIntent, openSkillChallengeFromSpec, parseStoredBeatSpec, runCombatPlaceholderEncounter,
} from './encounters.ts'
import type { StoredBeatSpec } from './encounters.ts'
import { narrationBeat } from './narration.ts'
import { endEncounter, startSocial } from './npc-dialogue.ts'
import { openPuzzleFromSpec } from './puzzle-encounter.ts'
import {
  appendLinesDiff, characterProfiles, loadPartyCharacters, newLine, partyProfileLines,
  partySkillList, typingDiff,
} from './orchestrate.ts'
import type { CharacterRow } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { applySceneEffects } from './scene-director.ts'
import { openSocialEncounter } from './social-encounter.ts'
import { runAdhocDesigner } from './story-agents.ts'
import { activeLoop } from '../_shared/story/index.ts'
import { noteSuspicion } from './steward.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

/** The open beat's stored spec, or null when the beat degraded to ad-hoc entries only. */
export async function openBeatSpec(
  service: SupabaseClient,
  adventureId: string,
): Promise<{ beatId: string | null; spec: StoredBeatSpec | null }> {
  const loop = activeLoop(await loadLoops(service, adventureId))
  if (!loop?.currentBeatId) return { beatId: null, spec: null }
  const { data, error } = await service
    .from('beats')
    .select('id, status, encounter_spec')
    .eq('id', loop.currentBeatId)
    .maybeSingle()
  assertOk(error, 'beat load failed')
  if (!data || data.status !== 'active') return { beatId: null, spec: null }
  return { beatId: data.id as string, spec: parseStoredBeatSpec((data.encounter_spec ?? null) as Json) }
}

export async function handleCutsceneIntent(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  kind: string,
  opts?: { lineAlreadyStaged?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }
  if (kind === 'say') {
    // Suspicion tagging (F08 SS8) survives the machine - never blocks the reply.
    try {
      await noteSuspicion(service, env, sessionId, text)
    } catch (err) {
      console.error('suspicion pass failed', err)
    }
  }

  const state = (await loadState(service, env.adventureId)).state
  const { beatId, spec } = await openBeatSpec(service, env.adventureId)
  const [party, locationRows, npcRows, recentEntryRows] = await Promise.all([
    loadPartyCharacters(service, env.adventureId),
    service.from('locations').select('name').eq('adventure_id', env.adventureId),
    service.from('npcs').select('name').eq('adventure_id', env.adventureId),
    service
      .from('event_log')
      .select('payload')
      .eq('adventure_id', env.adventureId)
      .eq('type', 'entry_mapped')
      .order('id', { ascending: false })
      .limit(3),
  ])
  // Anti-circling context (playtest 2026-07-20): the mapper sees what it already folded in,
  // so "I walk forward" a second time reads as commitment, never another fold.
  const recentFolds = ((recentEntryRows.data ?? []) as { payload: Record<string, Json> }[])
    .filter((e) => e.payload.entry === 'fold_in' && typeof e.payload.text === 'string')
    .map((e) => (e.payload.text as string).slice(0, 100))

  let mapping
  try {
    const profiles = await characterProfiles(service, party)
    mapping = await runEntryMapper(env, {
      text,
      actorSummary: profiles[character.id] ?? `${character.name}, level ${character.level} ${character.class_key ?? 'adventurer'}`,
      sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode}), day ${state.scene.day}`,
      hook: spec ? { kind: spec.kind, label: spec.label, stakes: spec.stakes } : null,
      knownLocations: ((locationRows.data ?? []) as { name: string }[]).map((l) => l.name),
      knownNpcs: ((npcRows.data ?? []) as { name: string }[]).map((n) => n.name),
      recentEvents: state.dialogue.lines.slice(-5).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`),
      recentFolds,
    })
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }
  const entry = mapping.entry === 'offered' && !spec ? 'fold_in' : mapping.entry
  try {
    return await executeEntry(service, env, sessionId, character, text, entry, mapping, spec, beatId, party)
  } catch (err) {
    // Never leave the table wedged on typing:true - the machine's cutscene handler is the
    // hot path for every full-AI input.
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    throw err
  }
}

async function executeEntry(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  entry: 'offered' | 'adhoc' | 'fold_in',
  mapping: { interpretation: string; sceneEffects: SceneEffects | null },
  spec: StoredBeatSpec | null,
  beatId: string | null,
  party: CharacterRow[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  await logEvent(service, env.adventureId, sessionId, 'entry_mapped', {
    entry, character_id: character.id, beat_id: beatId, text: text.slice(0, 200),
  })
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'ruling',
    payload: { entry, interpretation: mapping.interpretation } as unknown as Json,
    mode: 'auto',
    blocking: true,
    summary: `entry ${entry}: ${mapping.interpretation.slice(0, 60)}`,
  })

  // World movement rides on the reply (travel to the site, drawing NPCs in, time passing).
  // A non-social encounter is about to open, though, and a staged speaker takes absolute
  // routing priority over it - every subsequent input would become NPC dialogue and starve
  // the challenge (seen live: an NPC staged into a solo search scene). Travel and time still
  // apply; only the staging is dropped.
  let sceneNote = ''
  if (mapping.sceneEffects) {
    const opensNonSocial = entry === 'adhoc' ||
      (entry === 'offered' && spec !== null && ['combat', 'skill_challenge', 'puzzle'].includes(spec.kind))
    const effects = opensNonSocial && mapping.sceneEffects.stageNpcs.length > 0
      ? { ...mapping.sceneEffects, stageNpcs: [] }
      : mapping.sceneEffects
    if (effects !== mapping.sceneEffects) {
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', {
        effect: 'stage_npcs', proposed: mapping.sceneEffects.stageNpcs, reason: 'non-social encounter opening',
      })
    }
    const applied = await applySceneEffects(service, env, sessionId, effects, {
      stageNpcs: (npcIds) => startSocial(service, env.adventureId, env.creatorId, npcIds),
      endScene: () => endEncounter(service, env.adventureId, env.creatorId),
    })
    if (applied.traveledTo) sceneNote += ` The party has just arrived at ${applied.traveledTo}.`
    if (applied.staged.length > 0) sceneNote += ` Now in conversation: ${applied.staged.join(', ')}.`
    if (applied.dayAdvanced !== null) sceneNote += ' Meaningful time passes.'
  }

  if (entry === 'offered') {
    const offered = spec!
    if (offered.kind === 'combat') {
      await runCombatPlaceholderEncounter(service, env, sessionId, offered)
      return { status: 200, body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'combat' } }
    }
    if (offered.kind === 'skill_challenge') {
      const encounter = await openSkillChallengeFromSpec(service, env, sessionId, offered)
      await narrationBeat(
        service, env, sessionId,
        `The party commits: ${mapping.interpretation}.${sceneNote} The "${offered.label}" challenge ` +
          `begins${offered.stakes ? ` - at stake: ${offered.stakes}` : ''}. Make the situation ` +
          'concrete and end demanding their first move.',
        'Encounter entered',
      )
      return {
        status: 200,
        body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'skill_challenge', encounter_id: encounter.id },
      }
    }
    if (offered.kind === 'social') {
      const encounter = await openSocialEncounter(
        service, env, sessionId, offered,
        (npcIds) => startSocial(service, env.adventureId, env.creatorId, npcIds),
      )
      if (encounter) {
        await narrationBeat(
          service, env, sessionId,
          `The party engages: ${mapping.interpretation}.${sceneNote} The conversation ` +
            `("${offered.label}")${offered.stakes ? ` - at stake: ${offered.stakes} -` : ''} is now ` +
            'face to face. Set the scene in one or two sentences and let the NPC open, waiting on the party.',
          'Encounter entered',
        )
        return {
          status: 200,
          body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'social', encounter_id: encounter.id },
        }
      }
      // No NPC resolvable: fall through to ad-hoc structure below.
    }
    if (offered.kind === 'puzzle') {
      const encounter = await openPuzzleFromSpec(service, env, sessionId, offered)
      await narrationBeat(
        service, env, sessionId,
        `The party engages: ${mapping.interpretation}.${sceneNote} The puzzle ("${offered.label}")` +
          `${offered.stakes ? ` - at stake: ${offered.stakes} -` : ''} now stands before them. ` +
          'Describe what they can see and manipulate WITHOUT hinting at the solution, and end ' +
          'demanding their first idea.',
        'Encounter entered',
      )
      return {
        status: 200,
        body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'puzzle', encounter_id: encounter.id },
      }
    }
    if (!['combat', 'skill_challenge', 'social', 'puzzle'].includes(offered.kind)) {
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'encounter_kind_unimplemented', encounter_kind: offered.kind, beat_id: beatId,
      })
    }
  }

  if (entry === 'adhoc' || (entry === 'offered' && spec && !['combat', 'skill_challenge'].includes(spec.kind))) {
    const design = await runAdhocDesigner(env, mapping.interpretation, {
      size: party.length,
      skills: partySkillList(party),
      profiles: await partyProfileLines(service, party),
    })
    const adhocSpec: StoredBeatSpec = {
      kind: design.kind,
      label: design.label,
      stakes: design.stakes,
      params: (typeof design.params === 'object' && design.params !== null && !Array.isArray(design.params)
        ? design.params
        : {}) as Record<string, Json>,
      // Ad-hoc encounters carry no outcome map - agency without spine-skipping.
      onSuccess: [],
      onPartial: [],
      onFailure: [],
    }
    if (adhocSpec.kind === 'combat') {
      await runCombatPlaceholderEncounter(service, env, sessionId, adhocSpec)
      return { status: 200, body: { ok: true, resolved: 'adhoc_encounter', encounter_kind: 'combat' } }
    }
    const encounter = await openSkillChallengeFromSpec(service, env, sessionId, adhocSpec)
    // The off-script reply IS the endeavor - it doubles as the first attempt.
    const first = await handleChallengeIntent(service, env, sessionId, character, text, { lineAlreadyStaged: true })
    return {
      status: 200,
      body: { ok: true, resolved: 'adhoc_encounter', encounter_kind: 'skill_challenge', encounter_id: encounter.id, next: first.body.resolved ?? null },
    }
  }

  // fold_in: the action happens and CARRIES the party forward - a folded reply must never
  // read as the story circling back to a question already answered (playtest 2026-07-20).
  await narrationBeat(
    service, env, sessionId,
    `Carry this forward: ${character.name} - ${text}. Let it actually happen and MOVE the ` +
      `scene with it - describe what changes as they act.${sceneNote} Never re-ask a question ` +
      'the party already answered and never re-offer directions they already chose; if the ' +
      'fiction has one way onward, take them along it and give the in-fiction reason it is ' +
      'the way.' +
      (spec
        ? ` Their momentum should land them at the threshold of "${spec.label}"` +
          `${spec.stakes ? ` (at stake: ${spec.stakes})` : ''} - end there, demanding engagement ` +
          'with it, not another choice of direction.'
        : ' End at the next concrete thing demanding their response - never a menu of paths.'),
    'Cutscene',
    'outcome',
  )
  return { status: 200, body: { ok: true, resolved: 'folded_in' } }
}
