// Stage 2 - Story Director, per chapter: chapter arc -> 3-6 scene sketches (F04 SS2). Scenes
// are hidden scaffolding: never shown to players, retained as grounding context for stage 3
// objectives and the live-play Narrator/Beat Planner (SS4 "LLM strategy note").
// Also emits the chapter's ENTITY LIST (SS2.1): which global-registry entities appear here plus
// any new named entities its scenes introduce - stage 4's must-cover contract.

import { Check, extractJsonObject } from '../json.ts'
import { parseEntityList } from './stage1.ts'
import type { ChapterSketch, EntityRef, MetaLoop, ParseResult, SceneSketch } from '../types.ts'

export interface Stage2Context {
  metaLoop: MetaLoop
  chapters: ChapterSketch[]
  chapterIndex: number
}

export interface Stage2Output {
  scenes: SceneSketch[]
  entities: EntityRef[]
}

export const SCENES_PER_CHAPTER = { min: 3, max: 6 }

export function buildStage2Prompt(ctx: Stage2Context): { system: string; user: string; maxTokens: number } {
  const system = `You are the Story Director for a tabletop RPG platform. Break one chapter into ${SCENES_PER_CHAPTER.min}-${SCENES_PER_CHAPTER.max} scene sketches.

Rules:
- Scene sketches are HIDDEN DM scaffolding. Be concrete: where it happens, who is there, what is really going on, what must become true for the story to advance.
- Sketches are situations with tension, not scripts - never assume what the party chooses to do.
- Cover the whole chapter arc; the last scene should set up the next chapter (or the finale).
- entities: this chapter's entity list - every REGISTRY entity that appears in this chapter (copy its exact name) plus every NEW named NPC/location your scenes introduce. If a scene names it, it MUST be in this list; the content stage is required to flesh out exactly these.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "scenes": [ { "sketch": "3-5 sentence hidden scene sketch" } ],
  "entities": [ { "kind": "npc"|"location", "name": "exact name", "note": "one-line role" } ]
}`

  const chapter = ctx.chapters[ctx.chapterIndex]
  const otherChapters = ctx.chapters
    .map((ch, i) => `${i + 1}. ${ch.title}`)
    .join('\n')
  const registry = (ctx.metaLoop.entities ?? [])
    .map((e) => `- [${e.kind}] ${e.name}: ${e.note}`)
    .join('\n')

  const user = `Meta loop:
Premise: ${ctx.metaLoop.premise}
Antagonist: ${ctx.metaLoop.antagonist}
Stakes: ${ctx.metaLoop.stakes}
Arc: ${ctx.metaLoop.arc}

Global entity registry (reuse exact names):
${registry || '(none)'}

All chapters:
${otherChapters}

Chapter to sketch - ${ctx.chapterIndex + 1}. ${chapter.title}:
${chapter.arcSummary}`

  return { system, user, maxTokens: 2500 }
}

export function parseStage2(raw: string): ParseResult<Stage2Output> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const scenes = c
    .arr(extracted.data.scenes, '$.scenes', SCENES_PER_CHAPTER.min, SCENES_PER_CHAPTER.max)
    .map((raw, i) => ({ sketch: c.str(c.obj(raw, `$.scenes[${i}]`).sketch, `$.scenes[${i}].sketch`) }))
  const entities = parseEntityList(c, extracted.data.entities, '$.entities', 1, 20)

  return c.result({ scenes, entities })
}
