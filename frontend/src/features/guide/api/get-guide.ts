import { supabase } from '@/lib/supabase'
import type {
  BattleMap,
  Chapter,
  CoopSet,
  EncounterRow,
  Ending,
  GuideAdventure,
  GuideContract,
  GuideData,
  GuideJob,
  GuideWarning,
  Ingredient,
  LocationRow,
  Npc,
  Objective,
} from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- one boundary file maps untyped
   PostgREST rows into the feature's typed shapes */

function need<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what} failed: ${res.error?.message ?? 'no data'}`)
  return res.data
}

export async function getGuide(adventureId: string): Promise<GuideData> {
  const [adventure, chapters, objectives, npcs, locations, coopSets, ingredients, encounters, endings, contracts, warnings, jobs] =
    await Promise.all([
      supabase
        .from('adventures')
        .select('id, status, mode, min_players, max_players, type, plot_idea, narrator_voice_id, meta_loop, story_dials')
        .eq('id', adventureId)
        .single(),
      supabase.from('chapters').select('*').eq('adventure_id', adventureId).order('index'),
      supabase.from('objectives').select('*').eq('adventure_id', adventureId).order('index'),
      supabase.from('npcs').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('locations').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('coop_sets').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('ingredients').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('encounters').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('endings').select('*').eq('adventure_id', adventureId).order('index'),
      supabase.from('quest_contracts').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('guide_warnings').select('*').eq('adventure_id', adventureId).order('created_at'),
      supabase.from('guide_jobs').select('*').eq('adventure_id', adventureId).order('stage').order('created_at'),
    ])

  const a = need(adventure, 'adventure load') as any
  return {
    adventure: {
      id: a.id,
      status: a.status,
      mode: a.mode,
      minPlayers: a.min_players,
      maxPlayers: a.max_players,
      type: a.type,
      plotIdea: a.plot_idea,
      narratorVoiceId: a.narrator_voice_id,
      metaLoop: a.meta_loop,
      storyDials: a.story_dials ?? [],
    } satisfies GuideAdventure,
    chapters: need(chapters, 'chapters load').map(
      (c: any): Chapter => ({
        id: c.id,
        index: c.index,
        title: c.title,
        arcSummary: c.arc_summary,
        humanEdited: c.human_edited,
        pendingRegen: c.pending_regen,
      }),
    ),
    objectives: need(objectives, 'objectives load').map(
      (o: any): Objective => ({
        id: o.id,
        chapterId: o.chapter_id,
        index: o.index,
        title: o.title,
        hiddenDescription: o.hidden_description,
        completionPredicates: o.completion_predicates,
        revealState: o.reveal_state,
        linkedNpcIds: o.linked_npc_ids ?? [],
        linkedLocationIds: o.linked_location_ids ?? [],
        encounterIds: o.encounter_ids ?? [],
        humanEdited: o.human_edited,
        pendingRegen: o.pending_regen,
      }),
    ),
    npcs: need(npcs, 'npcs load').map(
      (n: any): Npc => ({
        id: n.id,
        chapterId: n.chapter_id,
        name: n.name,
        role: n.role,
        personality: n.personality ?? {},
        faction: n.faction,
        voiceId: n.voice_id,
        imagePrompt: n.image_prompt,
        images: n.images ?? {},
        description: n.description,
        statBlock: n.stat_block ?? null,
        humanEdited: n.human_edited,
        pendingRegen: n.pending_regen,
      }),
    ),
    locations: need(locations, 'locations load').map(
      (l: any): LocationRow => ({
        id: l.id,
        chapterId: l.chapter_id,
        name: l.name,
        description: l.description,
        imagePrompt: l.image_prompt,
        backgroundPath: l.background_url,
        previousBackgroundPaths: l.previous_background_urls ?? [],
        map: (l.map as BattleMap | null) ?? null,
        humanEdited: l.human_edited,
        pendingRegen: l.pending_regen,
      }),
    ),
    coopSets: need(coopSets, 'coop_sets load').map(
      (s: any): CoopSet => ({ id: s.id, chapterId: s.chapter_id, kind: s.kind, reveals: s.reveals }),
    ),
    ingredients: need(ingredients, 'ingredients load').map(
      (i: any): Ingredient => ({
        id: i.id,
        chapterId: i.chapter_id,
        type: i.type,
        content: i.content ?? {},
        placement: i.placement ?? {},
        reveals: i.reveals,
        pillarTags: i.pillar_tags ?? [],
        revealsTo: i.reveals_to,
        coopSetId: i.coop_set_id,
        objectiveLinks: i.objective_links ?? [],
        humanEdited: i.human_edited,
      }),
    ),
    encounters: need(encounters, 'encounters load').map(
      (e: any): EncounterRow => ({
        id: e.id,
        chapterId: e.chapter_id,
        type: e.type,
        spec: e.spec ?? {},
        budget: e.budget ?? {},
        locationId: e.location_id,
      }),
    ),
    endings: need(endings, 'endings load').map(
      (e: any): Ending => ({
        id: e.id,
        index: e.index,
        title: e.title,
        description: e.description,
        climaxSummary: e.climax_summary,
        tone: e.tone,
        triggerConditions: e.trigger_conditions ?? { summary: '', signals: [] },
        exclusivityGroup: e.exclusivity_group,
        isEmergent: e.is_emergent,
        status: e.status,
        humanEdited: e.human_edited,
        pendingRegen: e.pending_regen,
      }),
    ),
    contracts: need(contracts, 'contracts load').map(
      (k: any): GuideContract => ({
        id: k.id,
        chapterId: k.chapter_id,
        label: k.label,
        giverNpcId: k.giver_npc_id,
        isEntry: k.is_entry,
        reward: k.reward ?? {},
        stakes: k.stakes,
        deadline: k.deadline,
        objectiveIds: k.objective_ids ?? [],
        humanEdited: k.human_edited,
      }),
    ),
    warnings: need(warnings, 'warnings load').map(
      (w: any): GuideWarning => ({
        id: w.id,
        stage: w.stage,
        targetTable: w.target_table,
        targetId: w.target_id,
        message: w.message,
        resolved: w.resolved,
        kind: w.kind === 'info' ? 'info' : 'warning',
      }),
    ),
    jobs: need(jobs, 'jobs load').map(
      (j: any): GuideJob => ({
        id: j.id,
        stage: j.stage,
        chapterId: j.chapter_id,
        status: j.status,
        error: j.error,
        attempts: j.attempts,
      }),
    ),
  }
}
