// Stage 8 - Ending Designer, whole guide (F04 SS4.2): fleshes stage 1's ending premises into
// 3-5 hidden candidate endings - DIRECTION, not script: the canonical parts are title/tone/
// premise + trigger profile; climax_summary is an illustrative sketch that F08 re-authors live
// at commitment. Signals use a CLOSED vocabulary (objective outcomes, NPC states, story dial
// thresholds) so live play is guaranteed to be able to fire them; the LLM references objectives
// and NPCs by list number and the pipeline maps numbers to row UUIDs on insert. Also declares
// the adventure's 2-4 story dials. Runs last and flips the guide to ready.

import { Check, extractJsonObject } from '../json.ts'
import type {
  EndingDraft,
  EndingSignal,
  EndingSignalWhenDraft,
  Json,
  MetaLoop,
  NpcSignalState,
  ParseResult,
  StoryDialDraft,
} from '../types.ts'

export interface Stage8Context {
  metaLoop: MetaLoop
  chapters: { title: string; arcSummary: string }[]
  /** All objectives, chapter-ordered; signals reference them by 1-based position in this list. */
  objectives: { chapterNumber: number; title: string; hiddenDescription: string }[]
  /** All NPCs; signals reference them by 1-based position in this list. */
  npcs: { name: string; role: 'npc' | 'boss' }[]
}

export interface Stage8Output {
  dials: StoryDialDraft[]
  endings: EndingDraft[]
}

export const ENDINGS_PER_ADVENTURE = { min: 3, max: 5 }
export const SIGNALS_PER_ENDING = { min: 1, max: 8 }
export const DIALS_PER_ADVENTURE = { min: 2, max: 4 }
export const NPC_SIGNAL_STATES = ['dead', 'alive', 'allied', 'hostile'] as const
export const DIAL_RANGE = { min: -5, max: 5 }

export function buildStage8Prompt(ctx: Stage8Context): { system: string; user: string; maxTokens: number } {
  const system = `You are the Ending Designer for a tabletop RPG platform. Design ${ENDINGS_PER_ADVENTURE.min}-${ENDINGS_PER_ADVENTURE.max} HIDDEN candidate endings plus ${DIALS_PER_ADVENTURE.min}-${DIALS_PER_ADVENTURE.max} STORY DIALS for this adventure. During play the system scores each ending against tracked state and the story lands whichever one the players' actual choices are closest to - so endings must diverge on things players DO, not on luck.

Rules:
- Endings are DIRECTION, not script: "description" is the canonical 1-2 sentence resolution premise; "climax_summary" is only an illustrative sketch (1-2 sentences) - the real finale gets written during play from what actually happened.
- Endings must be meaningfully distinct outcomes (destroyed / redeemed / bargained-with / victorious-at-a-price), not tonal variations of one outcome.
- dials: ${DIALS_PER_ADVENTURE.min}-${DIALS_PER_ADVENTURE.max} adventure-specific trajectory axes tracked during play on a ${DIAL_RANGE.min}..${DIAL_RANGE.max} scale starting at 0 (e.g. key "mercy", name "Mercy vs. ruthlessness"). Keys are short lowercase snake_case. Pick axes on which THESE endings genuinely diverge.
- Each ending gets ${SIGNALS_PER_ENDING.min}-5 trigger signals. A signal's "when" is EXACTLY one of:
  {"objective": <number from the list>, "outcome": "completed"|"failed"}
  {"npc": <number from the list>, "state": "dead"|"alive"|"allied"|"hostile"}
  {"dial": "<dial key>", "gte" or "lte": <${DIAL_RANGE.min}..${DIAL_RANGE.max}>}
  Nothing else - no free-form flags or facts. "weight" is a signed nonzero number in [-5, 5] (negative = this condition argues AGAINST the ending). Use negative weights as counter-signals.
- EVERY ending needs at least one positively-weighted OBJECTIVE signal, and it should reference the FINAL objective in the list - the climax. Dials alone must never be able to land an ending: dials describe how the party played, objectives are what they actually did.
- Everything here is DM-only. Never reveal endings to players.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "dials": [ { "key": "mercy", "name": "Mercy vs. ruthlessness", "description": "what moves this dial up or down" } ],
  "endings": [
    {
      "title": "short hidden label",
      "description": "1-2 sentences - the canonical resolution premise",
      "climax_summary": "illustrative sketch of one way the finale could play out, 1-2 sentences",
      "tone": "triumphant|tragic|pyrrhic|bittersweet|...",
      "trigger_conditions": {
        "summary": "one line - what kind of play leads here",
        "signals": [ { "when": { "objective": 3, "outcome": "completed" }, "weight": 3, "note": "why this signal matters" } ]
      },
      "exclusivity_group": "main"
    }
  ]
}`

  const chapterList = ctx.chapters.map((ch, i) => `${i + 1}. ${ch.title}: ${ch.arcSummary}`).join('\n')
  const objectiveList = ctx.objectives
    .map((o, i) => `${i + 1}. (ch ${o.chapterNumber}) ${o.title} - ${o.hiddenDescription}`)
    .join('\n')
  const npcList = ctx.npcs.map((n, i) => `${i + 1}. ${n.name}${n.role === 'boss' ? ' (boss)' : ''}`).join('\n')
  const premises = (ctx.metaLoop.endingPremises ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n')

  const user = `Meta loop:
Premise: ${ctx.metaLoop.premise}
Antagonist: ${ctx.metaLoop.antagonist}
Stakes: ${ctx.metaLoop.stakes}
Arc: ${ctx.metaLoop.arc}

Ending premises from the Story Director:
${premises || '(none - design from the material below)'}

Chapters:
${chapterList}

Objectives (reference by number):
${objectiveList}

NPCs (reference by number):
${npcList || '(none)'}`

  return { system, user, maxTokens: 3500 }
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** Validates one closed-vocabulary "when" ref against the provided lists. Returns the parsed ref or null. */
export function parseSignalWhen(
  c: Check,
  value: unknown,
  path: string,
  objectiveCount: number,
  npcCount: number,
  dialKeys: Set<string>,
): EndingSignalWhenDraft | null {
  const w = c.obj(value, path)
  const keys = Object.keys(w)

  if ('objective' in w) {
    if (!isInt(w.objective) || w.objective < 1 || w.objective > objectiveCount) {
      c.errors.push(`${path}.objective: expected an objective number 1-${objectiveCount}`)
      return null
    }
    const outcome = c.oneOf(w.outcome, `${path}.outcome`, ['completed', 'failed'] as const)
    return { objective: w.objective, outcome }
  }

  if ('npc' in w) {
    if (!isInt(w.npc) || w.npc < 1 || w.npc > npcCount) {
      c.errors.push(`${path}.npc: expected an NPC number 1-${npcCount}`)
      return null
    }
    const state = c.oneOf(w.state, `${path}.state`, NPC_SIGNAL_STATES) as NpcSignalState
    return { npc: w.npc, state }
  }

  if ('dial' in w) {
    const dial = c.str(w.dial, `${path}.dial`)
    if (dial && !dialKeys.has(dial)) {
      c.errors.push(`${path}.dial: "${dial}" is not a declared dial (${[...dialKeys].join(', ') || 'none declared'})`)
    }
    const hasGte = w.gte !== undefined
    const hasLte = w.lte !== undefined
    if (hasGte === hasLte) {
      c.errors.push(`${path}: a dial signal needs exactly one of gte/lte`)
      return null
    }
    const bound = hasGte ? w.gte : w.lte
    if (!isInt(bound) || bound < DIAL_RANGE.min || bound > DIAL_RANGE.max) {
      c.errors.push(`${path}.${hasGte ? 'gte' : 'lte'}: expected an integer in [${DIAL_RANGE.min}, ${DIAL_RANGE.max}]`)
      return null
    }
    return hasGte ? { dial, gte: bound } : { dial, lte: bound }
  }

  c.errors.push(`${path}: expected exactly one of objective/npc/dial refs, got keys [${keys.join(', ')}]`)
  return null
}

export function parseStage8(raw: string, objectiveCount: number, npcCount: number): ParseResult<Stage8Output> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const root = extracted.data

  const dials: StoryDialDraft[] = c
    .arr(root.dials, '$.dials', DIALS_PER_ADVENTURE.min, DIALS_PER_ADVENTURE.max)
    .map((raw, i) => {
      const path = `$.dials[${i}]`
      const d = c.obj(raw, path)
      const key = c.str(d.key, `${path}.key`)
      if (key && !/^[a-z][a-z0-9_]*$/.test(key)) {
        c.errors.push(`${path}.key: "${key}" must be short lowercase snake_case`)
      }
      return {
        key,
        name: c.str(d.name, `${path}.name`),
        description: c.str(d.description ?? '', `${path}.description`, { allowEmpty: true }),
      }
    })
  const dialKeys = new Set(dials.map((d) => d.key))
  if (dialKeys.size !== dials.length) c.errors.push('$.dials: dial keys must be unique')

  const endings: EndingDraft[] = c
    .arr(root.endings, '$.endings', ENDINGS_PER_ADVENTURE.min, ENDINGS_PER_ADVENTURE.max)
    .map((raw, i) => {
      const path = `$.endings[${i}]`
      const e = c.obj(raw, path)
      const tc = c.obj(e.trigger_conditions, `${path}.trigger_conditions`)
      const signals: EndingSignal[] = c
        .arr(tc.signals, `${path}.trigger_conditions.signals`, SIGNALS_PER_ENDING.min, SIGNALS_PER_ENDING.max)
        .map((raw, j) => {
          const sPath = `${path}.trigger_conditions.signals[${j}]`
          const s = c.obj(raw, sPath)
          const when = parseSignalWhen(c, s.when, `${sPath}.when`, objectiveCount, npcCount, dialKeys)
          const weight = typeof s.weight === 'number' && Number.isFinite(s.weight) ? s.weight : NaN
          if (Number.isNaN(weight) || weight === 0 || Math.abs(weight) > 5) {
            c.errors.push(`${sPath}.weight: expected a nonzero number in [-5, 5]`)
          }
          return {
            when: when ?? ({ dial: '', gte: 0 } as EndingSignalWhenDraft),
            weight: Number.isNaN(weight) ? 1 : weight,
            note: c.str(s.note ?? '', `${sPath}.note`, { allowEmpty: true }),
          }
        })
      return {
        title: c.str(e.title, `${path}.title`),
        description: c.str(e.description, `${path}.description`),
        climaxSummary: c.str(e.climax_summary, `${path}.climax_summary`),
        tone: c.str(e.tone, `${path}.tone`),
        triggerConditions: {
          summary: c.str(tc.summary ?? '', `${path}.trigger_conditions.summary`, { allowEmpty: true }),
          signals,
        },
        exclusivityGroup: c.str(e.exclusivity_group ?? 'main', `${path}.exclusivity_group`, { allowEmpty: true }) || 'main',
      }
    })

  return c.result({ dials, endings })
}

/**
 * Maps a draft "when" (list numbers) to the stored DB shape (row UUIDs) - F04 SS4.2. The
 * caller passes ids in the SAME order the prompt listed them.
 */
export function signalWhenToStored(
  when: EndingSignalWhenDraft,
  objectiveIds: string[],
  npcIds: string[],
): Json {
  if ('objective' in when) return { objective_id: objectiveIds[when.objective - 1] ?? null, outcome: when.outcome }
  if ('npc' in when) return { npc_id: npcIds[when.npc - 1] ?? null, state: when.state }
  return when.gte !== undefined ? { dial: when.dial, gte: when.gte } : { dial: when.dial, lte: when.lte ?? 0 }
}

/**
 * F04 SS4.2 distinctness check - WARNINGS, not failures (surfaced as stage-8 guide_warnings):
 * endings with no positively-weighted signal, and near-duplicate endings. Ref grounding is the
 * parser's hard validation now, so there is no "ungrounded" warning anymore.
 */
export function validateEndingDistinctness(endings: EndingDraft[]): string[] {
  const warnings: string[] = []
  endings.forEach((ending, i) => {
    const label = ending.title || `ending ${i + 1}`
    if (!ending.triggerConditions.signals.some((s) => s.weight > 0)) {
      warnings.push(`"${label}" has no positively-weighted signal - nothing can ever argue FOR it.`)
    }
    for (let j = i + 1; j < endings.length; j++) {
      if (
        ending.tone.toLowerCase() === endings[j].tone.toLowerCase() &&
        ending.title.toLowerCase() === endings[j].title.toLowerCase()
      ) {
        warnings.push(`"${label}" and ending ${j + 1} look like duplicates (same title and tone).`)
      }
    }
  })
  return warnings
}

/**
 * An ending reachable by dials alone can never be earned: dials are a summarizer's read on how
 * the party played, while the commitment gate only opens once the objective ladder is done.
 * Every ending needs an objective signal, and the climax must decide something.
 */
export function validateEndingReachability(endings: EndingDraft[], objectiveCount: number): string[] {
  const warnings: string[] = []
  let climaxReferenced = false
  endings.forEach((ending, i) => {
    const label = ending.title || `ending ${i + 1}`
    const objectiveSignals = ending.triggerConditions.signals.filter((s) => 'objective' in s.when)
    if (objectiveSignals.length === 0) {
      warnings.push(`"${label}" has no objective signal - only dials could ever land it, which live play cannot guarantee.`)
    }
    if (objectiveSignals.some((s) => 'objective' in s.when && s.when.objective === objectiveCount)) {
      climaxReferenced = true
    }
  })
  if (objectiveCount > 0 && endings.length > 0 && !climaxReferenced) {
    warnings.push(`No ending references the final objective (#${objectiveCount}) - the climax decides nothing.`)
  }
  return warnings
}
