// Stage 1 - Story Director: plot -> meta loop + chapter arcs (F04 SS2). Commits the chapter
// count within the wizard's range; a one-shot is exactly one chapter.

import { Check, extractJsonObject } from '../json.ts'
import type { AdventureSeed, ChapterSketch, EntityRef, MetaLoop, ParseResult } from '../types.ts'

/** Shared entity-list parser for stages 1 and 2 (F04 SS2.1 registry entries). */
export function parseEntityList(c: Check, value: unknown, path: string, min: number, max: number): EntityRef[] {
  return c.arr(value, path, min, max).map((raw, i) => {
    const e = c.obj(raw, `${path}[${i}]`)
    return {
      kind: c.oneOf(e.kind, `${path}[${i}].kind`, ['npc', 'location'] as const),
      name: c.str(e.name, `${path}[${i}].name`),
      note: c.str(e.note ?? '', `${path}[${i}].note`, { allowEmpty: true }),
    }
  })
}

export interface Stage1Output {
  metaLoop: MetaLoop
  chapters: ChapterSketch[]
}

export function stage1ChapterBounds(seed: AdventureSeed): { min: number; max: number } {
  if (seed.type === 'one_shot') return { min: 1, max: 1 }
  return { min: seed.chaptersMin ?? 2, max: seed.chaptersMax ?? 12 }
}

export function buildStage1Prompt(seed: AdventureSeed): { system: string; user: string; maxTokens: number } {
  const { min, max } = stage1ChapterBounds(seed)
  const shape =
    seed.type === 'one_shot'
      ? 'This is a ONE-SHOT: produce exactly 1 chapter.'
      : `This is a multi-chapter campaign: commit to a chapter count between ${min} and ${max} (inclusive) - pick what the story needs, then stick to it.`

  const system = `You are the Story Director for a tabletop RPG platform. From a plot idea, design the adventure's meta loop (the long arc the antagonist drives regardless of the party) and its chapter arcs.

Rules:
- The meta loop must have a real antagonist with an agenda that advances on its own timeline.
- Chapter arc summaries are HIDDEN DM scaffolding: concrete, spoiler-rich, stating what is really going on and how the chapter moves the meta loop.
- Chapters must escalate; the final chapter builds to the climax WITHOUT fixing its outcome - the adventure has multiple possible endings, decided by how the players play.
- ending_premises: 2-4 one-line sketches of genuinely different resolutions (e.g. antagonist destroyed / redeemed / victorious at a price). They must diverge on player-driven choices, not luck.
- entities: the ENTITY REGISTRY - every named NPC and named location your premise, arc, and chapter summaries mention, each with a one-line note. If you name it in prose, it MUST be in this list (the antagonist included). Later stages are required to flesh out exactly these.
- ${shape}

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "meta_loop": {
    "premise": "one paragraph - what this adventure is about",
    "antagonist": "who drives the arc and what they want",
    "stakes": "what happens if the party fails",
    "arc": "how the antagonist's plan advances chapter by chapter"
  },
  "ending_premises": [ "one-line ending sketch" ],
  "entities": [ { "kind": "npc"|"location", "name": "exact name used in prose", "note": "one-line role" } ],
  "chapters": [
    { "title": "short chapter title", "arc_summary": "hidden DM summary of the chapter's real events, 3-6 sentences" }
  ]
}`

  const user = `Plot idea:\n${seed.plotIdea}\n\nParty size: ${seed.minPlayers}-${seed.maxPlayers} players. Mode: ${seed.mode === 'full_ai' ? 'fully AI-run' : 'AI-assisted human DM'}.`

  return { system, user, maxTokens: 3000 }
}

export function parseStage1(raw: string, seed: AdventureSeed): ParseResult<Stage1Output> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const root = extracted.data
  const meta = c.obj(root.meta_loop, '$.meta_loop')
  const metaLoop: MetaLoop = {
    premise: c.str(meta.premise, '$.meta_loop.premise'),
    antagonist: c.str(meta.antagonist, '$.meta_loop.antagonist'),
    stakes: c.str(meta.stakes, '$.meta_loop.stakes'),
    arc: c.str(meta.arc, '$.meta_loop.arc'),
    endingPremises: c
      .arr(root.ending_premises, '$.ending_premises', 2, 4)
      .map((p, i) => c.str(p, `$.ending_premises[${i}]`)),
    entities: parseEntityList(c, root.entities, '$.entities', 1, 30),
  }
  if (metaLoop.entities && !metaLoop.entities.some((e) => e.kind === 'npc')) {
    c.errors.push('$.entities: the registry must include at least the antagonist as an npc entity')
  }

  const { min, max } = stage1ChapterBounds(seed)
  const chapters = c.arr(root.chapters, '$.chapters', min, max).map((raw, i) => {
    const ch = c.obj(raw, `$.chapters[${i}]`)
    return {
      title: c.str(ch.title, `$.chapters[${i}].title`),
      arcSummary: c.str(ch.arc_summary, `$.chapters[${i}].arc_summary`),
    }
  })

  return c.result({ metaLoop, chapters })
}
