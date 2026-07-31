// Stage 7 - Consistency pass, whole guide: plot-hole scan across the hidden descriptions.
//
// CHECK ONLY, as of 2026-07-28. Between 2026-07-22 and then this stage also REPAIRED what it
// found - one constrained rewrite per flagged row, re-check, repeat - and the repair half is now
// deleted (see stages-weave.ts runStage7 for the measurements: eight of eight guides stalled and
// reverted, 28 planned edits, 0 survived, majors rose in seven). What survives is the scan, which
// is good at what the structural gates cannot see: it independently caught an unregistered ship
// that no closed-vocabulary check could. An empty warning list is a valid result.

import { Check, extractJsonObject } from '../json.ts'
import { entityNameMatches } from './stage4.ts'
import type { GuideDigest } from './stage6.ts'
import type { EntityRef, ParseResult, WarningDraft } from '../types.ts'

/**
 * F04 SS2.1: deterministic (non-LLM) check run alongside the consistency pass - flags every
 * GLOBAL registry entity that never landed in any chapter's entity list nor as a content row.
 * Warnings, not failures: chapter coverage is stage 4's hard check; this catches globals the
 * chapter lists dropped.
 */
export function validateRegistryCoverage(
  globalEntities: EntityRef[],
  chapterEntities: EntityRef[],
  npcNames: string[],
  locationNames: string[],
): string[] {
  const warnings: string[] = []
  for (const entity of globalEntities) {
    const rowPool = entity.kind === 'npc' ? npcNames : locationNames
    const covered =
      rowPool.some((name) => entityNameMatches(name, entity.name)) ||
      chapterEntities.some((e) => e.kind === entity.kind && entityNameMatches(e.name, entity.name))
    if (!covered) {
      warnings.push(
        `Registry ${entity.kind} "${entity.name}" (${entity.note}) is named in the story spine but never appears in any chapter or content row.`,
      )
    }
  }
  return warnings
}

/** Reported findings kept per pass. Stated in the prompt below, and trimmed rather than rejected. */
export const MAX_WARNINGS = 40

export function buildStage7Prompt(
  digest: GuideDigest,
  metaLoopArc: string,
): { system: string; user: string; maxTokens: number } {
  const system = `You are the Consistency Checker for a tabletop RPG platform. Scan an adventure guide's hidden scaffolding for plot holes and contradictions. You NEVER rewrite content - you only flag problems.

Look for:
- Contradictions between chapter arcs, objective hidden descriptions, and the meta loop.
- Objectives whose completion predicates reference NPCs/locations/flags that nothing establishes.
- Dead-end knowledge: information the players can never plausibly reach. Each ingredient says
  where it sits: one "held by" a person comes out in conversation with them, one "found in" a
  place is discovered by searching there, and one marked PLACED NOWHERE can never be found at all.
  A clue "held by X, also findable in Y" has two doors and needs only one of them to work.
- [absent] means NOT REACHABLE YET, not never. A villain the party corners in the finale is
  correctly absent at the start, and scenes that confront them are describing the moment they
  ARE reached. Flag it only when something the party meets EARLY depends on that person being
  there - never merely because a later scene has them present. [dead] is the permanent one: a
  corpse is never staged and never speaks, so a clue whose only door is a dead person's
  conversation can never open.
- Timeline impossibilities (an NPC in two places, an event before its cause).
- Spoiling titles: objective titles that give away a twist their hidden description relies on.
- Scene (node) prose that contradicts another scene, its objective, or the meta loop: two scenes
  describing the same place or person incompatibly, a scene assuming something an earlier one
  never established, or an arrival line that reads as a success when the party got there by
  failing.

A line ending in an ellipsis has been SHORTENED to fit this digest - the full text exists in the
guide and is complete. Never report such a line as cut off, truncated or incomplete; you are
looking at an excerpt, not the row.

The scene graph BRANCHES. The route nodes serving one objective are ALTERNATIVES - the party plays
at most one of them and the rest never happen. They are supposed to describe incompatible worlds:
one route breaks a barred door, another has the owner open it; one leaves a witness hostile,
another leaves them dead. That is the design, not a contradiction. Compare two scenes ONLY when
both can happen in the same playthrough - scenes serving DIFFERENT objectives, or a scene against
the meta loop. Never flag two routes of the same objective for disagreeing with each other.

A scene marked "(rescue)" is not authored content: it is the engine's guaranteed last resort,
materialized by code with a generated win line ("The party achieves this the hard way: ..."). It
exists so a party that has lost every real route still finishes. Never report one as vague, thin,
too easy, or as completing its objective without the work - that is what it is for.

Do NOT report:
- An NPC, location, item or rumour that no scene happens to use. An adventure carries TEXTURE -
  people to talk to, places to look at, rumours to chase - and live play improvises with it.
  Unused is not broken. Non-use is worth reporting ONLY when something DEPENDS on it: an
  objective's completion predicate, a hook that points at it, or a scene that assumes the party
  already has it.
- Something the party has not learned or reached YET. You are reading the DM's reference, not a
  script in play order: a clue names what it reveals before anyone finds it, a location describes
  what is there before anyone walks in, an objective states what is true before the party can see
  it, and a secret is written down long before it is told. "The party has no access to this at
  this point", "this is not established until later", "there is no context for them to notice
  this yet", "this is only a clue and not a scene" - every one of those describes a mystery
  working as intended. Discovery is the game. Report unreachability ONLY when NOTHING anywhere in
  the guide could ever deliver it - no scene, no NPC, no clue, in any chapter - and say which
  thing has no possible source.
- Detail that merely could be tighter, better connected, or more integrated. That is the
  creator's taste, not a defect.

Report each problem against the most specific handle you can. If the guide is coherent, return an empty list - do not invent problems.

Rate each finding's severity honestly:
- "major": a contradiction, an impossibility, unreachable content, or something that would break play - a creator MUST look at it.
- "minor": clarity, polish, or could-be-tighter observations - worth recording, not worth interrupting anyone.

Report at most ${MAX_WARNINGS} findings; past that only the first ${MAX_WARNINGS} are kept, so lead with the ones that would break play.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{ "warnings": [ { "target": "obj#3" | "npc#1" | null, "severity": "major"|"minor", "message": "one-sentence problem statement" } ] }`

  const lines = (m: Map<string, string>) => [...m.entries()].map(([h, l]) => `${h}: ${l}`).join('\n')
  const user = `Meta loop arc: ${metaLoopArc}

Objectives:
${lines(digest.objectives)}

NPCs:
${lines(digest.npcs)}

Locations:
${lines(digest.locations)}

Ingredients:
${lines(digest.ingredients)}${
    digest.nodes && digest.nodes.size > 0 ? `\n\nScenes (the playable nodes):\n${lines(digest.nodes)}` : ''
  }`

  return { system, user, maxTokens: 2500 }
}

export function parseStage7(raw: string, digest: GuideDigest): ParseResult<WarningDraft[]> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const known = new Set([
    ...digest.objectives.keys(),
    ...digest.npcs.keys(),
    ...digest.locations.keys(),
    ...digest.ingredients.keys(),
    ...(digest.nodes?.keys() ?? []),
  ])

  // A CONSISTENCY PASS MUST NEVER FAIL FOR FINDING TOO MUCH (2026-07-31 audit). The cap was
  // enforced here and stated nowhere, so a genuinely messy guide - the case this stage exists for -
  // could be rejected at 41 findings and take the generation down with it. Trimmed instead.
  const reported = c.arr(extracted.data.warnings ?? [], '$.warnings', 0)
  const warnings: WarningDraft[] = reported.slice(0, MAX_WARNINGS).map((raw, i) => {
    const path = `$.warnings[${i}]`
    const w = c.obj(raw, path)
    let targetHandle: string | null = null
    if (w.target != null) {
      targetHandle = c.str(w.target, `${path}.target`)
      // An unknown handle degrades to a guide-level warning rather than failing the stage - the
      // message is still useful even when the model fumbles the pointer.
      if (targetHandle && !known.has(targetHandle)) targetHandle = null
    }
    // Unrated findings count as major - the popup over-asking beats a contradiction hiding
    // in the collapsed list.
    const severity = w.severity === 'minor' ? 'minor' as const : 'major' as const
    return { targetHandle, message: c.str(w.message, `${path}.message`), severity }
  })

  return c.result(warnings)
}

