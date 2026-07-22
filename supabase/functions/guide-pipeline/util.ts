// Shared bits for the pipeline stages: adventure row -> seed mapping, slug keys for
// cross-chapter entity reuse, and the handle digests stages 6/7 address entities with.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { AdventureSeed, MetaLoop } from '../_shared/guide/types.ts'
import type { GuideDigest } from '../_shared/guide/stages/stage6.ts'

export interface AdventureRow {
  id: string
  creator_id: string
  plot_idea: string
  mode: 'full_ai' | 'assist' | null
  type: 'one_shot' | 'multi_chapter' | null
  chapters_min: number | null
  chapters_max: number | null
  min_players: number
  max_players: number
  difficulty_setting: { preset?: string } | null
  meta_loop: MetaLoop | null
  story_dials?: { key: string; name: string; description: string }[] | null
  status: string
}

export function toSeed(a: AdventureRow): AdventureSeed {
  return {
    plotIdea: a.plot_idea,
    mode: a.mode ?? 'assist',
    type: a.type ?? 'one_shot',
    chaptersMin: a.chapters_min,
    chaptersMax: a.chapters_max,
    minPlayers: a.min_players,
    maxPlayers: a.max_players,
    difficultyPreset: (a.difficulty_setting?.preset as AdventureSeed['difficultyPreset']) ?? null,
  }
}

export function difficultyOf(a: AdventureRow): 'easy' | 'standard' | 'hard' | 'deadly' {
  const preset = a.difficulty_setting?.preset
  return preset === 'easy' || preset === 'hard' || preset === 'deadly' ? preset : 'standard'
}

/** Deterministic local key for a row ("npc:mother-brine"), deduped within one keyed set. */
export function slugKeys<T extends { id: string; name: string }>(
  rows: T[],
  prefix: string,
): { list: { key: string; name: string; row: T }[]; byKey: Map<string, T> } {
  const byKey = new Map<string, T>()
  const list: { key: string; name: string; row: T }[] = []
  for (const row of rows) {
    const base = `${prefix}:${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed'}`
    let key = base
    for (let n = 2; byKey.has(key); n++) key = `${base}-${n}`
    byKey.set(key, row)
    list.push({ key, name: row.name, row })
  }
  return { list, byKey }
}

const clip = (text: unknown, len: number) => String(text ?? '').replaceAll('\n', ' ').slice(0, len)

export interface DigestRefs {
  digest: GuideDigest
  /** handle -> { table, id } for resolving model output back to rows. */
  refs: Map<string, { table: string; id: string }>
  objectiveIdByHandle: Map<string, string>
  /**
   * NPC handles legal as the ENTRY contract's giver: first-chapter or global (null-chapter)
   * NPCs. Stage 6 failed live on a multi-chapter guide (2026-07-22) because the model could
   * not see which NPCs were chapter-1 - the digest lines carried no chapter at all - so the
   * "giver must appear in the first chapter" rule was checkable only server-side, after the
   * job had already burned an attempt.
   */
  entryGiverHandles: string[]
}

/** Loads every guide entity and numbers them into stable handles (obj#1, npc#1, ...). */
export async function buildDigest(db: SupabaseClient, adventureId: string): Promise<DigestRefs> {
  const [chapters, objectives, npcs, locations, ingredients] = await Promise.all([
    db.from('chapters').select('id, index, title').eq('adventure_id', adventureId).order('index'),
    db.from('objectives').select('id, chapter_id, index, title, hidden_description').eq('adventure_id', adventureId),
    db.from('npcs').select('id, name, role, description, chapter_id').eq('adventure_id', adventureId).order('created_at'),
    db.from('locations').select('id, name, description, chapter_id').eq('adventure_id', adventureId).order('created_at'),
    db.from('ingredients').select('id, type, content, reveals').eq('adventure_id', adventureId).order('created_at'),
  ])
  for (const res of [chapters, objectives, npcs, locations, ingredients]) {
    if (res.error) throw new Error(`digest load failed: ${res.error.message}`)
  }

  const chapterNumber = new Map((chapters.data ?? []).map((c) => [c.id, c.index + 1]))
  const firstChapterId = (chapters.data ?? [])[0]?.id ?? null
  /** "(chapter N)" | "(global)" - the tag the GuideDigest contract always promised NPCs had. */
  const chapterTag = (chapterId: string | null) =>
    chapterId ? `(chapter ${chapterNumber.get(chapterId) ?? '?'})` : '(global)'
  const sortedObjectives = (objectives.data ?? []).sort(
    (a, b) => (chapterNumber.get(a.chapter_id) ?? 0) - (chapterNumber.get(b.chapter_id) ?? 0) || a.index - b.index,
  )

  const digest: GuideDigest = { objectives: new Map(), npcs: new Map(), locations: new Map(), ingredients: new Map() }
  const refs = new Map<string, { table: string; id: string }>()
  const objectiveIdByHandle = new Map<string, string>()
  const entryGiverHandles: string[] = []

  sortedObjectives.forEach((o, i) => {
    const handle = `obj#${i + 1}`
    digest.objectives.set(handle, `"${o.title}" (chapter ${chapterNumber.get(o.chapter_id)}) - ${clip(o.hidden_description, 180)}`)
    refs.set(handle, { table: 'objectives', id: o.id })
    objectiveIdByHandle.set(handle, o.id)
  })
  ;(npcs.data ?? []).forEach((n, i) => {
    const handle = `npc#${i + 1}`
    digest.npcs.set(handle, `${n.name}${n.role === 'boss' ? ' (boss)' : ''} ${chapterTag(n.chapter_id)} - ${clip(n.description, 150)}`)
    refs.set(handle, { table: 'npcs', id: n.id })
    if (n.chapter_id === null || n.chapter_id === firstChapterId) entryGiverHandles.push(handle)
  })
  ;(locations.data ?? []).forEach((l, i) => {
    const handle = `loc#${i + 1}`
    digest.locations.set(handle, `${l.name} ${chapterTag(l.chapter_id)} - ${clip(l.description, 120)}`)
    refs.set(handle, { table: 'locations', id: l.id })
  })
  ;(ingredients.data ?? []).forEach((ing, i) => {
    const handle = `ing#${i + 1}`
    const text = (ing.content as { text?: string } | null)?.text ?? ing.reveals
    digest.ingredients.set(handle, `${ing.type}: ${clip(text, 140)}`)
    refs.set(handle, { table: 'ingredients', id: ing.id })
  })

  return { digest, refs, objectiveIdByHandle, entryGiverHandles }
}

export function assertOk(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`)
}

/**
 * Best-effort event trail for pipeline actions (same event_log the session writes). Repairs
 * must be LOUD - the F04 SS2 amendment allows rewrites only with a full audit trail - but a
 * logging hiccup must never fail a stage that already did its work.
 */
export async function logPipelineEvent(
  db: SupabaseClient,
  adventureId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('event_log').insert({ adventure_id: adventureId, session_id: null, type, payload })
  if (error) console.error(`event ${type} insert failed`, error)
}
