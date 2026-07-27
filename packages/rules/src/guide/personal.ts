// Personal hook slots (story-engine overhaul, 2026-07-26): per-player stakes authored before the
// party exists, bound to real characters at first session.
//
// Two things live here: the slot shape + its parser (authoring), and the DETERMINISTIC matcher
// (binding). The matcher is the fallback that guarantees session start never blocks on an LLM -
// a bad match costs a bland intro, never a broken story, because personal atoms are barred from
// every structural position by the stage-8 lint.

import { Check } from './json.ts'
import { validatePredicate } from './predicates.ts'
import { canonicalizeAtomSlug } from '../story/atoms.ts'
import { listMilestoneAtoms } from '../story/evaluate.ts'
import type { ParseResult } from './types.ts'

export interface PersonalReward {
  gold?: number
  /** A narrative boon - a title, an ally, a favour. Not inventory (F11 owns real progression). */
  boon?: string
  /** Tag the climax author reads so a personal arc pays off in the epilogue. */
  epilogueTag?: string
}

export interface PersonalSlot {
  key: string
  archetype: { backgroundTags: string[]; classKeys: string[]; themes: string[] }
  introSeed: string
  objective: { label: string; predicate: unknown; reward: PersonalReward }
  overlays: { nodeKey: string; overlaySeed: string }[]
}

/** Max gold a personal arc may pay - kept well under quest rewards so it flavours, never carries. */
export const MAX_PERSONAL_GOLD = 50

export interface PersonalParseContext {
  /**
   * Node keys the overlays may attach to, IN THE ORDER shown to the author as `scene#1..N`.
   *
   * The model never sees a real key. Node keys embed a raw UUID
   * (`obj:0f391869-f4f1-4982-a14f-fb431970e2f5#n1`) and asking an LLM to transcribe one verbatim
   * is a coin flip - live 2026-07-26 EVERY overlay on EVERY slot was dropped for a mistyped key,
   * which then failed the stage-8 gate four times and blocked the whole guide. Short handles are
   * the same fix stages 6/7 already use (`obj#1`, `npc#1`): pick from a menu, code resolves it.
   */
  nodeKeys: string[]
  /** How many slots to expect - max_players plus a spare. */
  wanted: number
}

/** `scene#3` -> the third node key shown. Returns null for anything unparseable. */
export function resolveSceneHandle(handle: string, nodeKeys: readonly string[]): string | null {
  const match = /^scene#(\d+)$/.exec(handle.trim())
  if (!match) return null
  return nodeKeys[Number(match[1]) - 1] ?? null
}

export function buildPersonalSlotsPrompt(ctx: {
  premise: string
  arc: string
  wanted: number
  nodes: { key: string; summary: string }[]
}): { system: string; user: string; maxTokens: number } {
  const system = `You are the Hook Weaver for a tabletop RPG platform, authoring PERSONAL STAKES.

The party is not known yet - you are writing ${ctx.wanted} slots that different kinds of character could fill. Each slot is one person's private reason to be here.

Rules:
- Key each slot to ARCHETYPE, never a named person: background themes, classes, motives ("someone who lost family to this", "an outsider seeking legitimacy", "a debtor to the wrong people").
- intro_seed: the seed for 2-3 sentences establishing why this character is HERE at the start. A STAKE, never an agreement - never write that they have already decided to help or accepted a job.
- objective: a private goal this character can pursue alongside the main story. It must NEVER be required for the main plot, and never gate anyone else. Give it a label, 1-2 milestone atoms of its own (snake_case, distinct from the main story's), and a modest reward (at most ${MAX_PERSONAL_GOLD} gold, and/or a narrative boon like a title, an ally, or a favour owed).
- overlays: 1-2 scenes from the list where this personal thread can surface, referenced by their SHORT HANDLE exactly as listed ("scene#2"). Content that fits INSIDE that scene - a recognition, a private word, an object noticed - never a new scene.

Respond with ONLY a JSON object:
{ "slots": [ { "key": "the_bereaved",
    "archetype": { "background_tags": ["folk hero","urchin"], "class_keys": ["fighter"], "themes": ["revenge","loss"] },
    "intro_seed": "...",
    "objective": { "label": "Learn who gave the order", "atoms": ["order_giver_named"], "reward": { "gold": 25, "boon": "...", "epilogue_tag": "avenged" } },
    "overlays": [ { "scene": "scene#2", "overlay_seed": "..." } ] } ] }`

  const user = `Premise: ${ctx.premise}
Arc: ${ctx.arc}

Scenes available for overlays:
${ctx.nodes.map((n, i) => `scene#${i + 1}: ${n.summary}`).join('\n') || 'none'}

Author exactly ${ctx.wanted} slots, each meaningfully different from the others.`

  return { system, user, maxTokens: 3000 }
}

export function parsePersonalSlots(raw: string, ctx: PersonalParseContext): ParseResult<PersonalSlot[]> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return { ok: false, errors: ['response contains no JSON object'] }
  let root: Record<string, unknown>
  try {
    root = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch (err) {
    return { ok: false, errors: [`response JSON does not parse: ${err instanceof Error ? err.message : String(err)}`] }
  }

  const c = new Check()
  const nodeKeys = new Set(ctx.nodeKeys)
  const seenKeys = new Set<string>()

  const slots = c.arr(root.slots, '$.slots', 1, ctx.wanted + 2).flatMap((rawSlot, i) => {
    const path = `$.slots[${i}]`
    const s = c.obj(rawSlot, path)
    const key = canonicalizeAtomSlug(c.str(s.key, `${path}.key`))
    if (!key || seenKeys.has(key)) return []
    seenKeys.add(key)

    const arch = c.obj(s.archetype ?? {}, `${path}.archetype`)
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []

    const introSeed = c.str(s.intro_seed, `${path}.intro_seed`)

    const objective = c.obj(s.objective ?? {}, `${path}.objective`)
    const label = c.str(objective.label, `${path}.objective.label`)
    const atoms = strings(objective.atoms).slice(0, 2)
    if (atoms.length === 0) {
      c.errors.push(`${path}.objective.atoms: expected 1-2 personal milestone atoms`)
      return []
    }
    // The predicate is CODE-BUILT from the declared atoms, never free-authored: a personal
    // objective is a reward gate, and its shape should be boring and always satisfiable.
    const predicate = atoms.length === 1
      ? { flag: atoms[0], eq: true }
      : { all: atoms.map((a) => ({ flag: a, eq: true })) }
    const problems = validatePredicate(predicate)
    if (problems.length > 0) {
      c.errors.push(...problems.map((p) => `${path}.objective: ${p}`))
      return []
    }

    const rewardObj = c.obj(objective.reward ?? {}, `${path}.objective.reward`)
    const goldRaw = typeof rewardObj.gold === 'number' ? Math.floor(rewardObj.gold) : 0
    const reward: PersonalReward = {
      // Clamped, not rejected - an over-generous personal payout is a balance slip, not a
      // reason to fail authoring.
      ...(goldRaw > 0 ? { gold: Math.min(goldRaw, MAX_PERSONAL_GOLD) } : {}),
      ...(typeof rewardObj.boon === 'string' && rewardObj.boon.trim() ? { boon: rewardObj.boon.trim() } : {}),
      ...(typeof rewardObj.epilogue_tag === 'string' && rewardObj.epilogue_tag.trim()
        ? { epilogueTag: rewardObj.epilogue_tag.trim() }
        : {}),
    }

    const overlays = (Array.isArray(s.overlays) ? s.overlays : []).flatMap((o) => {
      if (typeof o !== 'object' || o === null) return []
      const ov = o as Record<string, unknown>
      // `scene#N` is the contract; a raw key is accepted too so a hand-edited row still parses.
      const raw = typeof ov.scene === 'string' ? ov.scene : typeof ov.node_key === 'string' ? ov.node_key : ''
      const nodeKey = resolveSceneHandle(raw, ctx.nodeKeys) ?? (nodeKeys.has(raw) ? raw : '')
      const overlaySeed = typeof ov.overlay_seed === 'string' ? ov.overlay_seed.trim() : ''
      return nodeKey && overlaySeed ? [{ nodeKey, overlaySeed }] : []
    }).slice(0, 2)

    return [{
      key,
      archetype: {
        backgroundTags: strings(arch.background_tags),
        classKeys: strings(arch.class_keys).map((k) => k.toLowerCase()),
        themes: strings(arch.themes),
      },
      introSeed,
      objective: { label, predicate, reward },
      overlays,
    }]
  })

  return c.result(slots)
}

/** Every personal atom a slot declares, canonicalized - what the lint bars from structure. */
export function personalAtoms(slot: PersonalSlot): string[] {
  const atoms = listMilestoneAtoms(slot.objective.predicate)
  return [...atoms.flags, ...atoms.events, ...atoms.facts].map(canonicalizeAtomSlug).filter(Boolean)
}

export interface BindableCharacter {
  id: string
  backgroundKey?: string | null
  classKey?: string | null
  /** Free text the player wrote - background narrative, personality, quirks. */
  text?: string | null
}

/**
 * Deterministic archetype matching - the fallback when the LLM binder is unavailable or returns
 * nothing usable. Greedy by best score, one slot per character, stable on ties (input order).
 *
 * Scoring is a word-overlap count, which is exactly the kind of shallow heuristic that must never
 * touch story structure - and here it does not: the worst outcome is a character getting a
 * less-apt personal intro.
 */
export function bindPersonalSlots(
  characters: readonly BindableCharacter[],
  slots: readonly PersonalSlot[],
): { characterId: string; slotKey: string }[] {
  const tokens = (text: string) =>
    new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3))

  const score = (character: BindableCharacter, slot: PersonalSlot): number => {
    let points = 0
    const background = (character.backgroundKey ?? '').toLowerCase()
    const klass = (character.classKey ?? '').toLowerCase()
    if (background && slot.archetype.backgroundTags.some((t) => t.toLowerCase() === background)) points += 4
    if (klass && slot.archetype.classKeys.includes(klass)) points += 3
    const words = tokens(`${character.text ?? ''} ${background}`)
    for (const theme of slot.archetype.themes) {
      if ([...tokens(theme)].some((t) => words.has(t))) points += 2
    }
    return points
  }

  const pairs: { characterId: string; slotKey: string; points: number; order: number }[] = []
  characters.forEach((character, ci) => {
    slots.forEach((slot, si) => {
      pairs.push({
        characterId: character.id, slotKey: slot.key,
        points: score(character, slot),
        order: ci * slots.length + si,
      })
    })
  })
  pairs.sort((a, b) => b.points - a.points || a.order - b.order)

  const takenCharacters = new Set<string>()
  const takenSlots = new Set<string>()
  const result: { characterId: string; slotKey: string }[] = []
  for (const pair of pairs) {
    if (takenCharacters.has(pair.characterId) || takenSlots.has(pair.slotKey)) continue
    takenCharacters.add(pair.characterId)
    takenSlots.add(pair.slotKey)
    result.push({ characterId: pair.characterId, slotKey: pair.slotKey })
  }
  // Every character gets a slot while slots remain: unbound characters are the one outcome that
  // reads as a bug to the player ("why does everyone else have a stake?").
  return result
}
