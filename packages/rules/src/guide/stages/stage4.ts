// Stage 4 - Ingredient Generator, per chapter: NPCs (incl. bosses), locations, and ingredients
// (clues/secrets/events/items/rumors), pillar-tagged and objective-linked (F04 SS2). When
// min_players > 1 it must also produce cooperative sets per SS4.1, within the coop-demand
// density guardrail (checked by validateCoopConformance below - also used by tests).

import { Check, extractJsonObject } from '../json.ts'
import type { NpcStatSeed } from '../npc-stats.ts'
import type {
  AdventureSeed,
  AffinityRef,
  ChapterSketch,
  CoopSetDraft,
  EntityRef,
  IngredientDraft,
  LocationDraft,
  MetaLoop,
  NpcDraft,
  ObjectiveDraft,
  ParseResult,
  SceneSketch,
} from '../types.ts'

export interface EstablishedEntity {
  key: string
  name: string
  /** What earlier chapters already made true of this entity - the anti-contradiction contract. */
  facts?: string[]
}

/** Renders the established-entity contract; empty when nothing exists yet (chapter 1). */
function establishedLines(label: string, entities: EstablishedEntity[]): string {
  if (entities.length === 0) return ''
  const rows = entities.map((e) => {
    const facts = (e.facts ?? []).filter(Boolean)
    return `- ${e.key} (${e.name})${facts.length > 0 ? `: ${facts.join('; ')}` : ''}`
  })
  return `Existing ${label} (reuse by key). What follows is ALREADY TRUE of them - never author anything that contradicts it:\n${rows.join('\n')}`
}

export interface Stage4Context {
  seed: AdventureSeed
  metaLoop: MetaLoop
  chapter: ChapterSketch
  chapterNumber: number
  scenes: SceneSketch[]
  objectives: ObjectiveDraft[]
  /** The chapter's entity list (F04 SS2.1): every entry MUST come back as a row or reuse. */
  requiredEntities: EntityRef[]
  /**
   * NPCs/locations already generated for earlier chapters, reusable by key - WITH what those
   * chapters established about them. Stage 4 runs once per chapter, and passing bare names let
   * chapter 4 author an entity that contradicted chapter 1: one generated guide made Elara Voss
   * simultaneously the victim's wife, the poisoner of his tea, and the servant framing someone
   * else for the murder (live 2026-07-21). No stage was wrong alone; none could see the others.
   */
  existingNpcs: EstablishedEntity[]
  existingLocations: EstablishedEntity[]
}

export interface Stage4Output {
  npcs: NpcDraft[]
  locations: LocationDraft[]
  coopSets: CoopSetDraft[]
  ingredients: IngredientDraft[]
  /** SS4.1 conformance repairs (demoted coop sets etc.) - persisted as stage-4 guide_warnings. */
  warnings: string[]
  /**
   * Registry entities stage 1 filed as `npc` that stage 4 declined to make into people. The
   * caller rewrites their kind to `lore` in meta_loop, or stage 5 and everything downstream
   * keeps inheriting the same mis-classification and re-fighting the same battle.
   */
  reclassifyAsLore: string[]
}

export const INGREDIENTS_PER_CHAPTER = { min: 4, max: 12, defaultMin: 6, defaultMax: 10 }
export const PILLAR_TAGS = ['combat', 'social', 'exploration'] as const
export const INGREDIENT_TYPES = ['clue', 'secret', 'event', 'item', 'rumor'] as const
export const COOP_KINDS = ['split_knowledge', 'complementary_obstacle'] as const

/**
 * A `placement.condition` the RUNTIME can actually satisfy. `filterReveals` gates a conditioned
 * ingredient on a PASSED CHECK and never reads the text, so the text must name one - anything
 * else locks the clue behind a roll that will never happen. See the repair at the parse site.
 */
const CHECK_CONDITION =
  /\b(dc\s*\d+|check|roll|save|persuasion|deception|intimidation|insight|investigation|perception|athletics|acrobatics|stealth|arcana|history|religion|nature|medicine|survival|performance|sleight)\b/i

/** F04 SS4.1 density guardrail: at most 1 coop-demanding obstacle per 3 objectives. */
export function maxCoopDemanding(objectiveCount: number): number {
  return Math.floor(objectiveCount / 3)
}

export function buildStage4Prompt(ctx: Stage4Context): { system: string; user: string; maxTokens: number } {
  const coopRules =
    ctx.seed.minPlayers > 1
      ? `
Cooperative content (REQUIRED - this adventure has ${ctx.seed.minPlayers}+ players):
- Produce at least one coop_set. "split_knowledge": decompose one deduction across 2-3 clue ingredients; each member clue gets a reveals_to affinity ({"skill": "religion"} or {"class": "rogue"} or {"background_tag": "criminal"}); the combined conclusion goes in the SET's "reveals" text, never on a single clue.
- "complementary_obstacle": an obstacle needing two proficiencies at the same time (hold the gate with Athletics while the lock is picked). At most ${maxCoopDemanding(ctx.objectives.length)} of these for this chapter's ${ctx.objectives.length} objectives - everything else must reward cooperation, not demand it.`
      : `
This can be played solo: do not create content that REQUIRES multiple simultaneous characters.`

  // The required entities are non-negotiable, so the ingredient ask is what has to give when a
  // chapter has a big cast. Court's multi-chapter stage 4 failed all four retries - truncating,
  // then malforming under the same pressure - because it was asked for a full ingredient spread
  // on top of the largest registry in the test set (live 2026-07-22).
  // Only entities that must become ROWS create response-length pressure; lore is one line of
  // context to write about, not a cast member to flesh out.
  const mandatoryEntities = ctx.requiredEntities.filter((e) => e.kind !== 'lore').length
  const ingredientMax = mandatoryEntities >= 8 ? 6 : INGREDIENTS_PER_CHAPTER.defaultMax
  const ingredientMin = Math.min(INGREDIENTS_PER_CHAPTER.min, ingredientMax)
  const system = `You are the Ingredient Generator for a tabletop RPG platform. For one chapter, produce NPCs, locations, and ingredients - the toys the DM places in the world.

LENGTH IS A HARD CONSTRAINT. This is the largest response in the pipeline and it is cut off if it
runs long - a truncated response is not a partial guide, it is NO guide, and multi-chapter
adventures failed to generate at all this way. Every description, reveals, note and image_prompt
is ONE short sentence. Never write two sentences where one carries the idea. Completing every
required entity briefly beats describing a few of them beautifully.

Rules:
- REQUIRED ENTITIES: the chapter's registry (listed below) names what the story already established. Every entry marked [npc] or [location] MUST appear in your response as a row with the EXACT same name (or be reused by existing key). Missing one is a validation failure. Entries marked [lore] are factions, forces and phenomena - they are world context to WRITE ABOUT, and you must NOT create rows for them.
- AN NPC IS ONE PERSON. Only create an npc row for an INDIVIDUAL the party could talk to or fight: someone with a name, a voice and opinions. Never create an npc for a group ("the city watch", "Valerius's agents", "the lost expedition") or for a force, curse or plague ("the Blight", "the Murkheart"). A group cannot hold a conversation, so giving it an npc row hands it a heartbeat, a mood and a seat in dialogue it can never use - and the game then treats killing a few of its members as the death of a person. Fights against a group are built from creature counts at the encounter stage, and if the party ever needs to TALK to a faction, name ONE representative of it as an individual npc (e.g. "Iron Hand Envoy Sera") and create that person instead.
- Ingredients are TOYS, not railroads: each one is something players can find, use, ignore, or subvert. Never a mandatory step.
- placement.condition means ONE thing: this clue needs a PASSED SKILL CHECK to come out. Write it as the check ("successful DC 14 persuasion", "an insight check"), or leave it null. It is NOT a place to describe when the moment is right - "asked about the money", "once they trust her" - because the game reads any condition as a check requirement, and a clue conditioned on a conversation is locked behind a roll that a conversation never makes. If a clue should simply come out when the topic arises, leave condition null and let the NPC judge the moment.
- ${ingredientMin}-${ingredientMax} ingredients for this chapter. ${ingredientMax} is a CAP, not a target to beat, and anything past ${INGREDIENTS_PER_CHAPTER.max} is discarded before the DM ever sees it - a chapter is made rich by what its clues connect, not by how many there are. Each is linked to ONE or TWO objectives by number (objective_numbers holds 1-2 entries, never more) and tagged with the pillars it serves ("combat", "social", "exploration").
- Every scene's cast and places must exist: create the NPCs and locations the scene sketches imply. Mark the chapter's main villain (if present here) as role "boss".
- "pronouns" is REQUIRED on every NPC: exactly one of "he/him", "she/her", "they/them", or "it/its" for a construct or creature. Write the pair and nothing else - not "male", not a sentence. The live narrator uses this and nothing else to refer to them, so a name that reads one way and pronouns that read another is a contradiction the players will see; pick deliberately and make the description agree with it.
- "initial_state" is where the NPC stands when play BEGINS: "alive" (default), "dead", or "absent" (alive but not reachable yet). A murder victim, or anyone the premise says is already dead or missing, MUST NOT be "alive" - the live game will otherwise stage them and have them speak.
- Reuse existing NPCs/locations by their key instead of duplicating them.
- Every location needs "features": 3-5 things in it a player might point at and examine, each with the DETAIL they find on looking closely. This is the single most-used thing you will author: players spend most of their turns asking about and examining the room, and anything you do not write here the narrator has to invent on the spot - which is where contradictions come from. Write what is THERE and what it tells them ("the bellows: the leather is new, replaced within the month, though the foundry has cast nothing in a year"), never a puzzle solution and never a secret the chapter is saving.
- Every location needs an "arrival_line": one or two sentences for the moment the party gets here, written so it works whether they walked, were sent, or arrived in a hurry. THIS IS WHERE A DISCOVERY BELONGS - the warmth rising from a cellar floor, the salt crust undisturbed since dawn. Only the party ever reads it.
- A location's "description" is the OPPOSITE: what the place IS to anyone who lives in this world, in one plain sentence ("a timber records building near the centre of the saltworks, where the wage ledgers are kept"). NPCs are given these so they can answer "what's the tallyhouse" instead of stonewalling or inventing, so a description must never contain something the party is meant to discover. If it is a secret, it goes in the arrival_line or an ingredient, never here.
- Keys are short lowercase slugs unique in this response, e.g. "npc:volgarth", "loc:sunken-chapel".
- image_prompt fields describe the visual for later image generation (style-neutral, concrete).
- Every NPC gets a lightweight "combat" block so it can appear in combat: pick an "archetype"
  (brute = melee bruiser, skirmisher = mobile fighter, sniper = ranged, caster = spellcaster,
  leader = commander/social, minion = weak mook) and a challenge rating "cr" from
  "0","1/8","1/4","1/2","1","2","3","4","5" (bosses roughly 2-5, common NPCs 0-1). Optionally give
  0-2 "skills" (proper-case skill names) and a signature "attack" name. Abilities/HP/AC are derived
  from archetype + cr - do NOT supply them.
- BE CONCISE: every description, ingredient text, and reveals field is 1-2 sentences. Depth comes
  from connections, not word count.
${coopRules}

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "npcs": [ { "key": "npc:...", "name": "...", "role": "npc"|"boss", "pronouns": "he/him"|"she/her"|"they/them"|"it/its", "initial_state": "alive"|"dead"|"absent", "personality": { "traits": "...", "voice": "...", "wants": "..." }, "faction": "...", "description": "...", "image_prompt": "...", "combat": { "cr": "1/4", "archetype": "brute"|"skirmisher"|"sniper"|"caster"|"leader"|"minion", "skills": ["Perception"], "attack": "Rusty Cutlass" } } ],
  "locations": [ { "key": "loc:...", "name": "...", "description": "...", "image_prompt": "...",
                   "arrival_line": "...",
                   "features": [ { "name": "the bellows", "detail": "what a character finds on looking closely" } ] } ],
  "coop_sets": [ { "key": "coop:...", "kind": "split_knowledge"|"complementary_obstacle", "reveals": "the combined conclusion once pooled" } ],
  "ingredients": [ { "type": "clue"|"secret"|"event"|"item"|"rumor", "content": { "text": "..." }, "placement": { "location_key": "...", "npc_key": "...", "condition": "..." }, "reveals": "...", "pillar_tags": ["social"], "reveals_to": null | {"skill":"..."} | {"class":"..."} | {"background_tag":"..."}, "coop_set_key": null | "coop:...", "objective_numbers": [1] } ]
}`

  const objectiveList = ctx.objectives
    .map((o, i) => `${i + 1}. ${o.title} - ${o.hiddenDescription}`)
    .join('\n')
  const sceneList = ctx.scenes.map((s, i) => `Scene ${i + 1}: ${s.sketch}`).join('\n')
  const existing = [
    establishedLines('NPCs', ctx.existingNpcs),
    establishedLines('locations', ctx.existingLocations),
  ]
    .filter(Boolean)
    .join('\n')

  const required = ctx.requiredEntities
    .map((e) => `- [${e.kind}] ${e.name}: ${e.note}`)
    .join('\n')

  // PUT WHAT IS KNOWN INTO PEOPLE, NOT ONLY ROOMS (2026-07-28).
  //
  // The response shape offers `location_key` and `npc_key` and said nothing about the balance, so
  // the model reached for rooms almost every time: across two measured guides, 10 of 17 clues were
  // location-placed and only 3 were on an NPC.
  //
  // That decides what play FEELS like, because the two are gated by different machinery. A
  // location clue is found by searching (discovery.ts, on a passed check). An NPC clue is
  // released by the reveal gate in a conversation. With the evidence in rooms, talking to people
  // yields nothing an investigation needs - live, 10 social encounters produced zero reveals while
  // every discovery came from a search.
  const placementRule =
    'PLACEMENT DECIDES HOW THE PARTY PLAYS. A clue on a LOCATION is found by searching it; a clue ' +
    'on an NPC is prised out of them in conversation. Put roughly half of what matters in ' +
    "people's heads - what someone saw, is hiding, will trade or lets slip - and reserve locations " +
    'for physical evidence that has to exist somewhere. An adventure whose every clue sits in a ' +
    'room gives the party no reason to talk to anyone, and its social scenes have nothing to give.'

  const user = `Meta loop antagonist: ${ctx.metaLoop.antagonist}

Chapter ${ctx.chapterNumber}: ${ctx.chapter.title}
Arc summary: ${ctx.chapter.arcSummary}

${placementRule}

REQUIRED entities (every one must become a row, exact names):
${required || '(none)'}

Scene sketches:
${sceneList}

Objectives:
${objectiveList}
${existing ? `\n${existing}` : ''}`

  // SIZED TO WHAT THIS STAGE ACTUALLY WRITES, NOT TO A ROUND NUMBER (2026-07-31).
  //
  // 4000 was set to keep the reply "well inside one edge invocation's wall clock". Measured, it
  // did the opposite. Stage 4 needs ~5600 tokens on glm-5.2, so every attempt bought a truncated
  // call at the cap (46-72s) AND the doubled retry that follows one (134-147s) - 180-220s against
  // a 150s kill, three attempts running, the last killed mid-call (live 2026-07-30, "By Dawn's
  // Light"). Replaying the same prompt with room to finish: one call, 84s, 5558 tokens, complete.
  //
  // A cap is a ceiling, not a spend: flash-lite writes this stage in ~3300 tokens and pays nothing
  // for the headroom. What the low cap bought was a guaranteed second call.
  return { system, user, maxTokens: 7000 }
}

/**
 * Read the optional NPC "combat" seed leniently: unknown/garbage values become undefined rather
 * than stage errors, because deriveNpcStatBlock coerces them to role-appropriate defaults - a
 * stray archetype typo should never fail an entire chapter's generation.
 */
function parseCombatSeed(value: unknown): NpcStatSeed {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const o = value as Record<string, unknown>
  const seed: NpcStatSeed = {}
  if (typeof o.cr === 'string') seed.cr = o.cr
  if (typeof o.archetype === 'string') seed.archetype = o.archetype
  if (typeof o.attack === 'string') seed.attack = o.attack
  if (Array.isArray(o.skills)) seed.skills = o.skills.filter((s): s is string => typeof s === 'string')
  return seed
}

function parseAffinity(c: Check, value: unknown, path: string): AffinityRef | null {
  if (value === null || value === undefined) return null
  const o = c.obj(value, path)
  const keys = Object.keys(o)
  const allowed = ['class', 'skill', 'background_tag']
  if (keys.length !== 1 || !allowed.includes(keys[0])) {
    c.errors.push(`${path}: expected exactly one of {"class"|"skill"|"background_tag": string}`)
    return null
  }
  const key = keys[0] as keyof AffinityRef
  return { [key]: c.str(o[keys[0]], `${path}.${keys[0]}`) }
}

export function parseStage4(raw: string, ctx: Stage4Context): ParseResult<Stage4Output> {
  const extracted = extractJsonObject(raw)
  if (!extracted.ok) return extracted

  const c = new Check()
  const root = extracted.data

  const PRONOUN_SETS = ['he/him', 'she/her', 'they/them', 'it/its']
  const npcs: NpcDraft[] = c.arr(root.npcs, '$.npcs', 0, 20).map((raw, i) => {
    const path = `$.npcs[${i}]`
    const n = c.obj(raw, path)
    return {
      key: c.str(n.key, `${path}.key`),
      name: c.str(n.name, `${path}.name`),
      role: c.oneOf(n.role, `${path}.role`, ['npc', 'boss'] as const),
      // Absent rather than guessed. Inferring a pronoun from a name in CODE would reproduce the
      // exact failure this field exists to fix, so an omission renders nothing and the narrator
      // falls back to the description, which is where it was reading from before.
      pronouns: PRONOUN_SETS.includes(n.pronouns as string)
        ? n.pronouns as NpcDraft['pronouns']
        : '',
      // Default alive: an omitted state must never silently kill someone off.
      initialState: n.initial_state === undefined
        ? 'alive'
        : c.oneOf(n.initial_state, `${path}.initial_state`, ['alive', 'dead', 'absent'] as const),
      personality: c.obj(n.personality ?? {}, `${path}.personality`) as NpcDraft['personality'],
      faction: c.str(n.faction ?? '', `${path}.faction`, { allowEmpty: true }),
      description: c.str(n.description, `${path}.description`),
      imagePrompt: c.str(n.image_prompt, `${path}.image_prompt`),
      combat: parseCombatSeed(n.combat),
    }
  })

  const locations: LocationDraft[] = c.arr(root.locations, '$.locations', 0, 15).map((raw, i) => {
    const path = `$.locations[${i}]`
    const l = c.obj(raw, path)
    // Features and arrival line are THIN, NOT FATAL - the same treatment narration_seed gets.
    // A guide that ships without them behaves exactly as guides did before 2026-07-29; failing a
    // paid generation over an omitted field is the worse outcome, and the pattern this file
    // already follows everywhere else.
    const features = c.arr(l.features ?? [], `${path}.features`, 0, 6).flatMap((f, fi) => {
      const feat = c.obj(f, `${path}.features[${fi}]`)
      const name = typeof feat.name === 'string' ? feat.name.trim() : ''
      const detail = typeof feat.detail === 'string' ? feat.detail.trim() : ''
      return name && detail ? [{ name, detail }] : []
    })
    return {
      key: c.str(l.key, `${path}.key`),
      name: c.str(l.name, `${path}.name`),
      description: c.str(l.description, `${path}.description`),
      imagePrompt: c.str(l.image_prompt, `${path}.image_prompt`),
      features,
      arrivalLine: typeof l.arrival_line === 'string' ? l.arrival_line.trim() : '',
    }
  })

  const coopFlaws: { key: string; reason: string }[] = []
  const coopSets: CoopSetDraft[] = c.arr(root.coop_sets ?? [], '$.coop_sets', 0, 10).map((raw, i) => {
    const path = `$.coop_sets[${i}]`
    const s = c.obj(raw, path)
    const key = typeof s.key === 'string' ? s.key.trim() : ''
    const kind = COOP_KINDS.find((k) => k === s.kind) ?? null
    const reveals = typeof s.reveals === 'string' ? s.reveals.trim() : ''
    // A COOP SET IS OPTIONAL CONTENT, INCLUDING WHEN IT IS MALFORMED (2026-07-31).
    //
    // Three lines below, this file promises that a nonconforming set is demoted to plain
    // ingredients with a warning and never fails the stage. The row's own fields were still hard
    // errors, so a solo adventure - one that was explicitly told not to author coop content -
    // lost a whole chapter to `$.coop_sets[0].reveals: expected a non-empty string` after a 111s
    // call (live, "By Dawn's Light"). The clues in that set were fine; only the pooled conclusion
    // was missing, and a set with no conclusion is exactly what demotion is for.
    if (!key) coopFlaws.push({ key: '', reason: `the set at ${path} had no key` })
    else if (!kind) coopFlaws.push({ key, reason: 'its "kind" was missing or unrecognised' })
    else if (!reveals) coopFlaws.push({ key, reason: 'it had no "reveals" text, so pooling its clues would conclude nothing' })
    return { key, kind: kind ?? 'split_knowledge', reveals }
  }).filter((s) => s.key !== '')

  const npcKeys = new Set([...ctx.existingNpcs.map((n) => n.key), ...npcs.map((n) => n.key)])
  const locationKeys = new Set([...ctx.existingLocations.map((l) => l.key), ...locations.map((l) => l.key)])
  const coopKeys = new Set(coopSets.map((s) => s.key))

  const conditionRepairs: string[] = []
  // TOO MANY TOYS IS NOT A BROKEN CHAPTER (2026-07-31).
  //
  // The count was fatal at BOTH ends, so a chapter that came back with 14 ingredients against an
  // ask of 4-6 failed the whole stage - 84s a call, twice, and the queue paused on
  // "$.ingredients: expected an array of length 4-12" (live, glm-5.2, "By Dawn's Light").
  // Nothing in that response was broken: the JSON parsed, the shape matched the template exactly,
  // the cast and the coop sets were right. The model was generous with the one field that is a
  // POOL rather than a contract - and a pool can be trimmed, which is what every other
  // overshoot in this parser already does (coop demotion, cleared conditions, thin features).
  //
  // The floor stays fatal. A chapter with two clues in it is genuinely thin and worth re-rolling,
  // and no code can invent the missing ones.
  const rawIngredients = c.arr(root.ingredients, '$.ingredients', INGREDIENTS_PER_CHAPTER.min)
  const dropped = Math.max(0, rawIngredients.length - INGREDIENTS_PER_CHAPTER.max)
  const ingredients: IngredientDraft[] = rawIngredients
    .slice(0, INGREDIENTS_PER_CHAPTER.max)
    .map((raw, i) => {
      const path = `$.ingredients[${i}]`
      const ing = c.obj(raw, path)
      const placementRaw = c.obj(ing.placement ?? {}, `${path}.placement`)
      const placement: IngredientDraft['placement'] = {}
      if (placementRaw.location_key != null) {
        placement.locationKey = c.str(placementRaw.location_key, `${path}.placement.location_key`)
        if (placement.locationKey && !locationKeys.has(placement.locationKey)) {
          c.errors.push(`${path}.placement.location_key: unknown key "${placement.locationKey}"`)
        }
      }
      if (placementRaw.npc_key != null) {
        placement.npcKey = c.str(placementRaw.npc_key, `${path}.placement.npc_key`)
        if (placement.npcKey && !npcKeys.has(placement.npcKey)) {
          c.errors.push(`${path}.placement.npc_key: unknown key "${placement.npcKey}"`)
        }
      }
      // A CONDITION MEANS "BEHIND A PASSED CHECK", AND NOTHING ELSE (2026-07-28).
      //
      // The runtime reads this field as a hard gate: `filterReveals` refuses any conditioned
      // ingredient unless a check passed, and never looks at the text. Stage 4 was given the field
      // with no explanation of it and filled it with CONVERSATIONAL triggers - "asked why she
      // suspects financial irregularities", "confronted with evidence the entries are fabricated".
      // Those describe a moment in a conversation, and conversations do not roll checks, so every
      // clue written that way was unreachable for the whole adventure.
      //
      // Measured: across three runs, every NPC-placed clue carried such a condition and NPC reveals
      // totalled ZERO, while the one refusal on record reads "condition not met: asked why she
      // suspects financial irregularities". The NPC held it and offered it; the gate could not say
      // yes.
      //
      // Dropping a mis-written condition is the safe direction. The clue becomes reachable and the
      // NPC agent still decides WHEN to offer it - which is what a conversational trigger was
      // trying to express anyway, and what the agent already does. A clue nobody can ever reach is
      // strictly worse than one that arrives a beat early.
      if (placementRaw.condition != null) {
        const raw = c.str(placementRaw.condition, `${path}.placement.condition`)
        if (raw && CHECK_CONDITION.test(raw)) {
          placement.condition = raw
        } else if (raw) {
          conditionRepairs.push(raw)
        }
      }

      const pillarTags = c.arr(ing.pillar_tags, `${path}.pillar_tags`, 1, 3).map((t, j) =>
        c.oneOf(t, `${path}.pillar_tags[${j}]`, PILLAR_TAGS),
      )

      let coopSetKey: string | null = null
      if (ing.coop_set_key != null) {
        coopSetKey = c.str(ing.coop_set_key, `${path}.coop_set_key`)
        if (coopSetKey && !coopKeys.has(coopSetKey)) {
          c.errors.push(`${path}.coop_set_key: unknown key "${coopSetKey}"`)
        }
      }

      const objectiveIndexes = c
        .arr(ing.objective_numbers, `${path}.objective_numbers`, 1, ctx.objectives.length)
        .map((n, j) => c.int(n, `${path}.objective_numbers[${j}]`, 1, ctx.objectives.length) - 1)

      return {
        type: c.oneOf(ing.type, `${path}.type`, INGREDIENT_TYPES),
        content: c.obj(ing.content, `${path}.content`) as IngredientDraft['content'],
        placement,
        reveals: c.str(ing.reveals ?? '', `${path}.reveals`, { allowEmpty: true }),
        pillarTags,
        revealsTo: parseAffinity(c, ing.reveals_to, `${path}.reveals_to`),
        coopSetKey,
        objectiveIndexes,
      }
    })

  // Malformed sets are demoted here rather than at the row above, because demotion needs the
  // ingredients: a member whose set is dropped stays in the pool as a plain clue, and its key had
  // to survive until now so its own `coop_set_key` still resolved.
  const flawWarnings: string[] = []
  const usableCoopSets = coopSets.filter((set) => {
    const flaw = coopFlaws.find((f) => f.key === set.key)
    if (!flaw) return true
    for (const ing of ingredients) {
      if (ing.coopSetKey === set.key) ing.coopSetKey = null
    }
    flawWarnings.push(`coop set "${set.key}" was demoted to plain ingredients: ${flaw.reason}`)
    return false
  })

  // Coop conformance is a QUALITY bar, not a structural contract: nonconforming sets are
  // repaired (demoted to plain ingredients) with warnings, never a stage failure - same
  // philosophy as parseCombatSeed above and stage 5's budget warnings.
  const repaired = repairCoopConformance(usableCoopSets, ingredients, ctx.seed.minPlayers, ctx.objectives.length)

  const coverage = validateEntityCoverage(
    ctx.requiredEntities,
    [...npcs.map((n) => n.name), ...ctx.existingNpcs.map((n) => n.name)],
    [...locations.map((l) => l.name), ...ctx.existingLocations.map((l) => l.name)],
  )
  c.errors.push(...coverage.errors)
  for (const entity of coverage.reclassifyAsLore) {
    repaired.warnings.push(
      `Registry entity "${entity.name}" (${entity.note}) was filed as an NPC but stage 4 did ` +
        `not make it a person - reclassified as lore (a group, force or faction, not an individual).`,
    )
  }

  // A chapter with nobody alive to talk to cannot host a social encounter, and live play has
  // no way to author its way out - Below the Sunken Chapel shipped with exactly two NPCs, one
  // dead and one absent, and its only social route to the objective could never open (live
  // 2026-07-22). Hard error into the existing regeneration loop.
  if (npcs.length > 0 && npcs.every((n) => n.initialState === 'dead' || n.initialState === 'absent')) {
    c.errors.push(
      '$.npcs: every NPC in this chapter is dead or absent - the party would have nobody to ' +
        'talk to. Keep the premise, but give the chapter at least one LIVING, reachable ' +
        'NPC the party can actually meet (a survivor, a witness, a rival investigator).',
    )
  }

  return c.result({
    npcs,
    locations,
    coopSets: repaired.coopSets,
    ingredients,
    warnings: [
      ...flawWarnings,
      ...repaired.warnings,
      // Trimming from the end can strip a coop set's member clues; repairCoopConformance above
      // then demotes that set with its own warning, which is the right outcome and already covered.
      ...(dropped > 0
        ? [`stage 4 returned ${rawIngredients.length} ingredients for a chapter capped at ` +
           `${INGREDIENTS_PER_CHAPTER.max}; the last ${dropped} were dropped.`]
        : []),
      ...(conditionRepairs.length > 0
        ? [`${conditionRepairs.length} ingredient condition(s) were cleared: they describe a ` +
           'conversational moment rather than a skill check, and the reveal gate reads ANY ' +
           'condition as "requires a passed check" - so each would have locked its clue away for ' +
           `the whole adventure. Cleared: ${conditionRepairs.slice(0, 3).map((r) => `"${r}"`).join('; ')}`]
        : []),
    ],
    reclassifyAsLore: coverage.reclassifyAsLore.map((e) => e.name),
  })
}

function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Lenient name match: exact after normalization, or one contains the other ("Lyra" vs "High Priestess Lyra"). */
export function entityNameMatches(a: string, b: string): boolean {
  const na = normalizeEntityName(a)
  const nb = normalizeEntityName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * F04 SS2.1 must-cover check: every registry PLACE must land as a row.
 *
 * People are different, and the difference is the whole point. Stage 1 classifies entities
 * before anyone has thought hard about them, and it routinely files a group under `npc` -
 * "Silver Scale Guild guards", "Valerius's Agents", "Thorne's Agents". Stage 4 is told plainly
 * that an NPC is ONE PERSON, so it declines to make those into people. That refusal used to
 * collide with this contract and deadlock: stage 4 would not create the row, the contract
 * demanded it, four retries burned, generation dead (live 2026-07-23, The Tidewater Vault -
 * "required npc Silver Scale Guild guards is missing from the response").
 *
 * So take the refusal as the answer. An `npc` entity stage 4 declines to materialize, after
 * being told exactly what an NPC is, is stage 4 reporting that stage 1 mis-filed it - and the
 * caller reclassifies it to `lore`, where groups and forces belong. The absence IS the signal;
 * no new schema field, no second opinion, nothing to prompt for.
 *
 * Places stay a hard error. A location is unambiguous - there is no "this place is really a
 * group" failure mode - so a missing one is a genuine omission worth a retry.
 */
export function validateEntityCoverage(
  required: EntityRef[],
  npcNames: string[],
  locationNames: string[],
): { errors: string[]; reclassifyAsLore: EntityRef[] } {
  const errors: string[] = []
  const reclassifyAsLore: EntityRef[] = []
  for (const entity of required) {
    // `lore` entities (factions, forces, phenomena) are named world context, NOT rows - they
    // have no life state, disposition or staging slot because they are not individuals.
    if (entity.kind === 'lore') continue
    const pool = entity.kind === 'npc' ? npcNames : locationNames
    if (pool.some((name) => entityNameMatches(name, entity.name))) continue
    if (entity.kind === 'npc') reclassifyAsLore.push(entity)
    else {
      errors.push(`required location "${entity.name}" (${entity.note}) is missing from the response - every registry location must become a row`)
    }
  }
  return { errors, reclassifyAsLore }
}

/**
 * F04 SS4.1 conformance repair: instead of failing the stage, nonconforming coop sets are
 * DEMOTED - the set is dropped and its member ingredients stay as plain (non-coop) ingredients,
 * each repair recorded as a warning for the DM. Mutates members' coopSetKey in place; returns
 * the surviving sets.
 */
export function repairCoopConformance(
  coopSets: CoopSetDraft[],
  ingredients: IngredientDraft[],
  minPlayers: number,
  objectiveCount: number,
): { coopSets: CoopSetDraft[]; warnings: string[] } {
  const warnings: string[] = []
  const demotedKeys = new Set<string>()
  const demote = (set: CoopSetDraft, reason: string) => {
    demotedKeys.add(set.key)
    for (const ing of ingredients) {
      if (ing.coopSetKey === set.key) ing.coopSetKey = null
    }
    warnings.push(`coop set "${set.key}" was demoted to plain ingredients: ${reason}`)
  }

  for (const set of coopSets) {
    const members = ingredients.filter((i) => i.coopSetKey === set.key)
    if (set.kind === 'split_knowledge') {
      const reasons: string[] = []
      if (members.length < 2 || members.length > 3) reasons.push(`needs 2-3 member ingredients, has ${members.length}`)
      if (members.some((m) => m.type !== 'clue')) reasons.push('all members must be clues')
      if (members.some((m) => !m.revealsTo)) reasons.push('every member needs a reveals_to affinity')
      if (reasons.length > 0) demote(set, reasons.join('; '))
    } else if (members.length === 0) {
      demote(set, 'has no member ingredients')
    }
  }

  const cap = maxCoopDemanding(objectiveCount)
  const demanding = coopSets.filter((s) => !demotedKeys.has(s.key) && s.kind === 'complementary_obstacle')
  for (const set of demanding.slice(cap)) {
    demote(set, `over the density guardrail (at most ${cap} coop-demanding obstacle(s) for ${objectiveCount} objectives)`)
  }

  const kept = coopSets.filter((s) => !demotedKeys.has(s.key))
  if (minPlayers > 1 && kept.length === 0) {
    warnings.push('this chapter ended up with no cooperative content (min_players > 1 asks for at least one coop set per chapter) - consider adding a split-knowledge clue pair by hand')
  }

  return { coopSets: kept, warnings }
}

/**
 * F04 SS4.1 conformance as a pure check (used by the test suite and as the definition the
 * repair above enforces):
 * - min_players > 1 => at least one coop set per chapter, and split-knowledge sets decompose
 *   across 2-3 member clues that each carry a reveals_to affinity.
 * - density guardrail: coop-DEMANDING (complementary_obstacle) sets capped at 1 per 3 objectives.
 */
export function validateCoopConformance(
  output: Pick<Stage4Output, 'coopSets' | 'ingredients'>,
  minPlayers: number,
  objectiveCount: number,
): string[] {
  const errors: string[] = []
  const { coopSets, ingredients } = output

  const demanding = coopSets.filter((s) => s.kind === 'complementary_obstacle')
  const cap = maxCoopDemanding(objectiveCount)
  if (demanding.length > cap) {
    errors.push(
      `coop density guardrail: ${demanding.length} coop-demanding obstacle(s) but at most ${cap} allowed for ${objectiveCount} objectives`,
    )
  }

  if (minPlayers > 1 && coopSets.length === 0) {
    errors.push('min_players > 1 requires at least one coop_set in every chapter')
  }

  for (const set of coopSets) {
    const members = ingredients.filter((i) => i.coopSetKey === set.key)
    if (set.kind === 'split_knowledge') {
      if (members.length < 2 || members.length > 3) {
        errors.push(`coop set "${set.key}": split_knowledge needs 2-3 member ingredients, has ${members.length}`)
      }
      for (const [i, member] of members.entries()) {
        if (member.type !== 'clue') {
          errors.push(`coop set "${set.key}" member ${i}: split_knowledge members must be clues`)
        }
        if (!member.revealsTo) {
          errors.push(`coop set "${set.key}" member ${i}: split_knowledge members need a reveals_to affinity`)
        }
      }
    } else if (members.length === 0) {
      errors.push(`coop set "${set.key}": has no member ingredients`)
    }
  }

  return errors
}
