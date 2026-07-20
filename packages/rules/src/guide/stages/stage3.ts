// Stage 3 - Story Director, per chapter: scenes -> ordered objectives (F04 SS2). Objectives are
// short open phrases (<= 6 words, enforced here AND by prompt), with hidden descriptions and
// structured completion predicates (SS4).

import { Check, countWords, extractJsonObject } from '../json.ts'
import { validatePredicate } from '../predicates.ts'
import type { ChapterSketch, MetaLoop, ObjectiveDraft, ParseResult, SceneSketch } from '../types.ts'

export interface Stage3Context {
  metaLoop: MetaLoop
  chapter: ChapterSketch
  chapterNumber: number
  scenes: SceneSketch[]
  /** 'one_shot' keeps the objective ladder short; longer forms may use the full range. */
  adventureType?: string
  /** Titles already authored for earlier chapters - stage 3 runs per chapter and would
   *  otherwise re-author the same objective ("Secure the forged deed" twice, live 2026-07-20). */
  priorObjectiveTitles?: string[]
  /** Chapters in the adventure, so the remaining total can be shared out sensibly. */
  chapterCount?: number
}

export const OBJECTIVE_TITLE_MAX_WORDS = 6
export const OBJECTIVES_PER_CHAPTER = { min: 1, max: 6 }
/**
 * Per chapter of a multi-chapter adventure. The open 1-6 range let a 4-chapter mystery author
 * 16 objectives for a solo level-1 party (live 2026-07-20) - at the observed rate of roughly
 * one objective per 26 turns that is a ~400-turn story nobody finishes.
 */
export const MULTI_CHAPTER_OBJECTIVES = { min: 2, max: 4 }
/**
 * The cap that actually binds. Capping per chapter still allowed 4 x 4 = 16 across a
 * multi-chapter guide (observed 15), because the driver is chapter count, not chapter size.
 * Later chapters get whatever of this total is left.
 */
export const MULTI_CHAPTER_TOTAL_OBJECTIVES = 10
/** A one-shot is a whole story in one chapter, so its ladder must carry all three acts. */
export const ONE_SHOT_OBJECTIVES = { min: 3, max: 4 }

/**
 * One-shots used to be told "AT MOST 2-3 objectives", which authored Act 1 and stopped: both
 * objectives were setup, and the endings then demanded proof nothing in the ladder could
 * produce. The ladder now has to reach a climax, authored against the promised endings.
 */
function oneShotArcRules(ctx: Stage3Context): string {
  const premises = (ctx.metaLoop.endingPremises ?? []).filter(Boolean)
  return `- This is a ONE-SHOT adventure: author ${ONE_SHOT_OBJECTIVES.min}-${ONE_SHOT_OBJECTIVES.max} objectives forming a complete three-act spine - setup, escalation/complication, then a CLIMAX.
- The LAST objective is the climax: a confrontation or decisive act that resolves the story, not more investigation or setup. Its completion is what earns an ending.
${premises.length > 0 ? `- The climax objective must make one of these promised endings reachable: ${premises.join(' | ')}.\n` : ''}`
}

/**
 * Multi-chapter chapters share ONE ladder budget. Live play completes roughly one objective per
 * 26 turns, so a 15-16 rung ladder is a story nobody reaches the end of.
 */
const FINAL_CHAPTER_RULE =
  '- This is the FINAL chapter: its last objective is the climax, the decisive act that earns ' +
  'an ending.\n'

function multiChapterArcRules(ctx: Stage3Context): string {
  const used = (ctx.priorObjectiveTitles ?? []).length
  const chapters = Math.max(ctx.chapterCount ?? 1, 1)
  const remainingChapters = Math.max(chapters - (ctx.chapterNumber - 1), 1)
  const remaining = Math.max(MULTI_CHAPTER_TOTAL_OBJECTIVES - used, MULTI_CHAPTER_OBJECTIVES.min)
  // Leave room for the chapters after this one; the last chapter may spend what is left.
  const fairShare = Math.max(Math.floor(remaining / remainingChapters), MULTI_CHAPTER_OBJECTIVES.min)
  const max = Math.min(fairShare, MULTI_CHAPTER_OBJECTIVES.max, remaining)
  return `- Author ${MULTI_CHAPTER_OBJECTIVES.min}-${max} objectives for THIS chapter - each a distinct step the party must actually finish, not a restatement of a neighbouring step. The whole adventure gets at most ${MULTI_CHAPTER_TOTAL_OBJECTIVES} objectives across all ${chapters} chapters and ${used} are already authored, so spend this chapter's share and no more.
${ctx.chapterNumber >= chapters ? FINAL_CHAPTER_RULE : ''}`
}

export function buildStage3Prompt(ctx: Stage3Context): { system: string; user: string; maxTokens: number } {
  const system = `You are the Story Director for a tabletop RPG platform. Turn a chapter's scene sketches into an ORDERED list of ${OBJECTIVES_PER_CHAPTER.min}-${OBJECTIVES_PER_CHAPTER.max} player-facing objectives.

Rules:
- Objective titles are AT MOST ${OBJECTIVE_TITLE_MAX_WORDS} words, phrased short and OPEN ("Defeat Volgarth", "Find the missing caravan") - they must not spoil twists or prescribe a method.
- hidden_description is DM-only: what this objective is really about, which scenes ground it, and what the party does not yet know. It exists to catch plot holes.
- completion_predicates is a JSON predicate over world state, NEVER a reference to a specific encounter. The live engine can ONLY satisfy atoms from this exact vocabulary - anything else never completes. Grammar:
  atom: {"flag": "<snake_case_milestone>", "eq": true} - a concrete accomplishment live play can recognize ("lantern_relit", "keeper_freed"). PREFER flags.
  atom: {"event": "<short past-tense marker>"} - e.g. "party entered the sunken crypt", "the ritual was interrupted".
  combinators: {"any": [<predicate>...]}, {"all": [<predicate>...]}
- NEVER use "fact" atoms - live play does not write them (NPC status is tracked by internal id, not by name).
- Prefer "any" combinators that honor multiple resolutions (kill OR ally OR outwit); keep any "all" chain to at most 2 atoms.${''}

${ctx.adventureType === 'one_shot'
  ? oneShotArcRules(ctx)
  : multiChapterArcRules(ctx)}${
  (ctx.priorObjectiveTitles ?? []).length > 0
    ? `- Earlier chapters already cover these - do NOT repeat or re-word any of them: ${(ctx.priorObjectiveTitles ?? []).join(' | ')}.
`
    : ''}
Respond with ONLY a JSON object, no prose, in exactly this shape:
{ "objectives": [ { "title": "...", "hidden_description": "...", "completion_predicates": { ... } } ] }`

  const sceneList = ctx.scenes.map((s, i) => `Scene ${i + 1}: ${s.sketch}`).join('\n')
  const user = `Meta loop antagonist: ${ctx.metaLoop.antagonist}
Stakes: ${ctx.metaLoop.stakes}

Chapter ${ctx.chapterNumber}: ${ctx.chapter.title}
Arc summary: ${ctx.chapter.arcSummary}

Scene sketches:
${sceneList}`

  return { system, user, maxTokens: 3000 }
}

function containsFactAtom(predicate: unknown): boolean {
  if (typeof predicate !== 'object' || predicate === null || Array.isArray(predicate)) return false
  const p = predicate as Record<string, unknown>
  if (typeof p.fact === 'string') return true
  if (Array.isArray(p.any)) return p.any.some(containsFactAtom)
  if (Array.isArray(p.all)) return p.all.some(containsFactAtom)
  return false
}

export function parseStage3(raw: string): ParseResult<ObjectiveDraft[]> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const objectives = c
    .arr(extracted.data.objectives, '$.objectives', OBJECTIVES_PER_CHAPTER.min, OBJECTIVES_PER_CHAPTER.max)
    .map((raw, i) => {
      const path = `$.objectives[${i}]`
      const o = c.obj(raw, path)
      const title = c.str(o.title, `${path}.title`)
      if (title && countWords(title) > OBJECTIVE_TITLE_MAX_WORDS) {
        c.errors.push(`${path}.title: "${title}" is over ${OBJECTIVE_TITLE_MAX_WORDS} words`)
      }
      const predicateErrors = validatePredicate(o.completion_predicates, `${path}.completion_predicates`)
      c.errors.push(...predicateErrors)
      if (predicateErrors.length === 0 && containsFactAtom(o.completion_predicates)) {
        // Live play can never write fact atoms (F14 milestone vocabulary is flags + events),
        // so a fact-based objective would be uncompletable - hard-fail into regeneration.
        c.errors.push(`${path}.completion_predicates: "fact" atoms are not completable by live play - use flags or events`)
      }
      return {
        title,
        hiddenDescription: c.str(o.hidden_description, `${path}.hidden_description`),
        completionPredicates: (o.completion_predicates ?? null) as ObjectiveDraft['completionPredicates'],
      }
    })

  const seen = new Set<string>()
  for (const objective of objectives) {
    const key = objective.title.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) c.errors.push(`$.objectives: duplicate objective title "${objective.title}"`)
    seen.add(key)
  }

  return c.result(objectives)
}
