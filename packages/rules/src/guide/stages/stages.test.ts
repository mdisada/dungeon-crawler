import { describe, expect, it } from 'vitest'

import {
  buildTestDigest,
  SEED,
  SOLO_SEED,
  STAGE1_RESPONSE,
  STAGE1_RESPONSE_TOO_MANY_CHAPTERS,
  STAGE2_RESPONSE,
  STAGE3_RESPONSE,
  STAGE3_RESPONSE_BAD,
  STAGE4_CONTEXT,
  STAGE4_RESPONSE,
  STAGE5_CONTEXT,
  STAGE5_RESPONSE,
  STAGE6_RESPONSE,
  STAGE7_RESPONSE,
  STAGE8_NPC_COUNT,
  STAGE8_OBJECTIVE_COUNT,
  STAGE8_RESPONSE,
} from '../__fixtures__/stage-fixtures.ts'
import { parseStage1, stage1ChapterBounds } from './stage1.ts'
import { parseStage2 } from './stage2.ts'
import {
  buildStage3Prompt, MULTI_CHAPTER_OBJECTIVES, MULTI_CHAPTER_TOTAL_OBJECTIVES, ONE_SHOT_OBJECTIVES,
  parseStage3,
} from './stage3.ts'
import {
  buildStage4CastPrompt, buildStage4IngredientsPrompt, entityNameMatches, maxCoopDemanding, parseStage4, parseStage4Cast,
  parseStage4Ingredients, validateCoopConformance,
  validateEntityCoverage,
} from './stage4.ts'
import { parseStage5 } from './stage5.ts'
import { parseStage6 } from './stage6.ts'
import { parseStage7, validateRegistryCoverage } from './stage7.ts'
import { parseStage8, validateEndingDistinctness, validateEndingReachability } from './stage8.ts'

const parseStage8Fixture = (raw: string) => parseStage8(raw, STAGE8_OBJECTIVE_COUNT, STAGE8_NPC_COUNT)

describe('stage 1 (chapter arcs)', () => {
  it('parses a code-fenced response and keeps chapter count in range', () => {
    const result = parseStage1(STAGE1_RESPONSE, SEED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.chapters).toHaveLength(2)
    expect(result.data.metaLoop.antagonist).toContain('Mother Brine')
    // F04 SS4.2: stage 1 seeds 2-4 divergent ending premises for stage 8.
    expect(result.data.metaLoop.endingPremises).toHaveLength(3)
  })

  it('requires 2-4 ending premises', () => {
    const withoutPremises = STAGE1_RESPONSE.replace(/"ending_premises": \[[^\]]*\],/, '"ending_premises": [],')
    const result = parseStage1(withoutPremises, SEED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('ending_premises'))).toBe(true)
  })

  it('rejects a chapter count outside the wizard range', () => {
    const result = parseStage1(STAGE1_RESPONSE_TOO_MANY_CHAPTERS, SEED)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('$.chapters')
  })

  it('bounds one-shots to exactly one chapter', () => {
    expect(stage1ChapterBounds({ ...SEED, type: 'one_shot' })).toEqual({ min: 1, max: 1 })
    const result = parseStage1(STAGE1_RESPONSE, { ...SEED, type: 'one_shot' })
    expect(result.ok).toBe(false)
  })

  it('rejects non-JSON responses with a useful error', () => {
    const result = parseStage1('The adventure begins at dawn...', SEED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/no JSON object/)
  })

  it('KEEPS a faction as lore instead of dropping it (2026-07-23)', () => {
    // Dropping these left the model exactly two buckets - npc and location - so a faction or a
    // force had to be authored as a PERSON. That is how "Valerius's Agents" got a life state
    // and a disposition, and how an adventure whose only two "NPCs" were a dead group and an
    // absent force ended up unwinnable. Kept as lore they are named and described, never staged.
    const withFaction = STAGE1_RESPONSE.replace(
      '"entities": [',
      '"entities": [\n    { "kind": "faction", "name": "The Salvagers", "note": "the cult" },',
    )
    const result = parseStage1(withFaction, SEED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const salvagers = result.data.metaLoop.entities?.find((e) => e.name === 'The Salvagers')
    expect(salvagers).toBeDefined()
    expect(salvagers?.kind).toBe('lore')
    // Critically: it did NOT become a person.
    expect(salvagers?.kind).not.toBe('npc')
  })

  it('an explicit lore entity round-trips', () => {
    const withLore = STAGE1_RESPONSE.replace(
      '"entities": [',
      '"entities": [\n    { "kind": "lore", "name": "The Blight", "note": "the spreading corruption" },',
    )
    const result = parseStage1(withLore, SEED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.metaLoop.entities?.find((e) => e.name === 'The Blight')?.kind).toBe('lore')
  })
})

describe('stage 2 (scene sketches)', () => {
  it('parses a response with prose preamble and its entity list', () => {
    const result = parseStage2(STAGE2_RESPONSE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.scenes).toHaveLength(4)
    // F04 SS2.1: the chapter's entity list is stage 4's must-cover contract.
    expect(result.data.entities.map((e) => e.name)).toContain('Mother Brine')
    expect(result.data.entities.some((e) => e.kind === 'location')).toBe(true)
  })

  it('enforces 3-6 scenes per chapter', () => {
    const short = JSON.stringify({ scenes: [{ sketch: 'only one' }], entities: [{ kind: 'npc', name: 'X', note: '' }] })
    const result = parseStage2(short)
    expect(result.ok).toBe(false)
  })

  it('requires at least one entity', () => {
    const noEntities = JSON.parse(STAGE2_RESPONSE.slice(STAGE2_RESPONSE.indexOf('{')))
    noEntities.entities = []
    const result = parseStage2(JSON.stringify(noEntities))
    expect(result.ok).toBe(false)
  })
})

describe('stage 3 (objectives + predicates)', () => {
  it('parses objectives with valid predicates', () => {
    const result = parseStage3(STAGE3_RESPONSE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(3)
    expect(result.data[0].title).toBe('Learn why the tide stopped')
  })

  it('rejects titles over 6 words and malformed predicates, reporting both', () => {
    const result = parseStage3(STAGE3_RESPONSE_BAD)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('over 6 words'))).toBe(true)
    expect(result.errors.some((e) => e.includes('completion_predicates'))).toBe(true)
  })

  it('demands a three-act ladder ending in a climax for one-shots', () => {
    const ctx = {
      metaLoop: { premise: 'p', antagonist: 'a', stakes: 's', arc: 'x', endingPremises: ['The killer walks free'] },
      chapter: { title: 'One night', arcSummary: 'a murder' },
      chapterNumber: 1,
      scenes: [{ sketch: 'the body is found' }],
      adventureType: 'one_shot',
    }
    const { system } = buildStage3Prompt(ctx)
    expect(system).toContain(`${ONE_SHOT_OBJECTIVES.min}-${ONE_SHOT_OBJECTIVES.max} objectives`)
    expect(system).toContain('CLIMAX')
    expect(system).toContain('The killer walks free')
    // Multi-chapter chapters get their own, tighter cap.
    const multi = buildStage3Prompt({ ...ctx, adventureType: 'multi_chapter' }).system
    expect(multi).not.toContain('CLIMAX')
    expect(multi).toContain(`${MULTI_CHAPTER_OBJECTIVES.min}-${MULTI_CHAPTER_OBJECTIVES.max} objectives`)
  })

  it('shares ONE ladder budget across chapters, shrinking as it is spent', () => {
    const chapter = (n: number, prior: string[]) => buildStage3Prompt({
      metaLoop: { premise: 'p', antagonist: 'a', stakes: 's', arc: 'x' },
      chapter: { title: `Ch${n}`, arcSummary: 'arc' },
      chapterNumber: n,
      scenes: [{ sketch: 'a scene' }],
      adventureType: 'multi_chapter',
      chapterCount: 4,
      priorObjectiveTitles: prior,
    }).system

    // Chapter 1 of 4 may not spend the whole budget on itself.
    expect(chapter(1, [])).toContain(`at most ${MULTI_CHAPTER_TOTAL_OBJECTIVES} objectives`)
    expect(chapter(1, [])).toContain(`${MULTI_CHAPTER_OBJECTIVES.min}-2 objectives for THIS chapter`)
    // With most of the ladder already authored, later chapters get the floor, never the max.
    const nearlySpent = chapter(4, Array.from({ length: 9 }, (_, i) => `obj ${i}`))
    expect(nearlySpent).toContain(`${MULTI_CHAPTER_OBJECTIVES.min}-${MULTI_CHAPTER_OBJECTIVES.min} objectives`)
    expect(nearlySpent).toContain('FINAL chapter')
  })

  it('tells a later chapter not to re-author earlier objectives', () => {
    const system = buildStage3Prompt({
      metaLoop: { premise: 'p', antagonist: 'a', stakes: 's', arc: 'x' },
      chapter: { title: 'Ch2', arcSummary: 'more' },
      chapterNumber: 2,
      scenes: [{ sketch: 'a scene' }],
      adventureType: 'multi_chapter',
      priorObjectiveTitles: ['Secure the forged deed'],
    }).system
    expect(system).toContain('do NOT repeat')
    expect(system).toContain('Secure the forged deed')
  })

  it('accepts an objective whose predicate has no claimable atom (2026-07-27)', () => {
    // This was a hard error until objectives stopped completing by predicate. An eq:false flag is
    // never written by a milestone, which used to mean "this objective can never finish, so
    // regenerate the whole chapter". Objectives resolve when a scene resolves now, so the cost of
    // an unclaimable predicate is one flavour flag nobody sets - not worth failing paid
    // generation over.
    const result = parseStage3(JSON.stringify({
      objectives: [{
        title: 'Keep the gate shut',
        hidden_description: 'The party must never open it.',
        completion_predicates: { flag: 'gate_opened', eq: false },
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it('defaults an unlabelled objective to kind main - the safe direction (2026-07-29)', () => {
    // A side thread wrongly marked main costs a losable thread; a plot point wrongly marked side
    // lets the spine lose a fact later objectives assume. Only the second one breaks stories.
    const result = parseStage3(JSON.stringify({
      objectives: [{ title: 'Reach the drowned quay', hidden_description: 'The way in.', completion_predicates: { flag: 'quay_reached', eq: true } }],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data[0].kind).toBe('main')
  })

  it('keeps an authored side objective', () => {
    const result = parseStage3(JSON.stringify({
      objectives: [
        { title: 'Recover the pawned locket', kind: 'side', hidden_description: 'Optional colour.', completion_predicates: { flag: 'locket_recovered', eq: true } },
        { title: 'Break the Drowned Accord', kind: 'main', hidden_description: 'The climax.', completion_predicates: { flag: 'accord_broken', eq: true } },
      ],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.map((o) => o.kind)).toEqual(['side', 'main'])
  })

  it('refuses a climax the party is allowed to lose', () => {
    // The last objective is what earns an ending. It can never be the losable one.
    const result = parseStage3(JSON.stringify({
      objectives: [
        { title: 'Find the ledger', kind: 'main', hidden_description: 'Setup.', completion_predicates: { flag: 'ledger_found', eq: true } },
        { title: 'Recover the locket', kind: 'side', hidden_description: 'Optional.', completion_predicates: { flag: 'locket_recovered', eq: true } },
      ],
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/climax and must be kind "main"/)
  })

  it('refuses a chapter with no spine at all', () => {
    const result = parseStage3(JSON.stringify({
      objectives: [{ title: 'Recover the locket', kind: 'side', hidden_description: 'Optional.', completion_predicates: { flag: 'locket_recovered', eq: true } }],
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/at least one objective must be kind "main"/)
  })

  it('accepts an event-only predicate as claimable (2.1)', () => {
    const result = parseStage3(JSON.stringify({
      objectives: [{
        title: 'Enter the sunken crypt',
        hidden_description: 'The descent is the whole objective.',
        completion_predicates: { any: [{ event: 'party entered the sunken crypt' }, { flag: 'crypt_reached', eq: true }] },
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects a hidden_description that ends mid-thought (form check, rides regeneration)', () => {
    // "Success here means the pa" shipped live and only surfaced as residue a human had to read.
    const result = parseStage3(JSON.stringify({
      objectives: [{
        title: 'Resist the shared dream',
        hidden_description: 'Success here means the pa',
        completion_predicates: { flag: 'dream_resisted', eq: true },
      }],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('ends mid-thought'))).toBe(true)
  })

  it('rejects a chapter that authors the same objective twice', () => {
    const objective = (title: string) => ({
      title,
      hidden_description: 'why it matters',
      completion_predicates: { flag: 'deed_secured', eq: true },
    })
    const result = parseStage3(JSON.stringify({
      objectives: [objective('Secure the forged deed'), objective('Secure the forged deed')],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('duplicate objective title'))).toBe(true)
  })
})

describe('stage 4 pronouns', () => {
  const withNpc = (npc: Record<string, unknown>) => {
    // No regex: the fence markers are fixed strings, and a code fence inside a template literal is
    // exactly the kind of escaping that goes wrong silently.
    const body = STAGE4_RESPONSE.split('```json').join('').split('```').join('').trim()
    const parsed = JSON.parse(body)
    // Patch the FIRST npc only - dropping the rest fails validateEntityCoverage, which has nothing
    // to do with what is under test here.
    parsed.npcs = (parsed.npcs as Record<string, unknown>[])
      .map((n, i) => (i === 0 ? { ...n, ...npc } : n))
    return parseStage4(JSON.stringify(parsed), STAGE4_CONTEXT)
  }

  it('keeps an authored pronoun pair', () => {
    const r = withNpc({ pronouns: 'he/him' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.npcs[0].pronouns).toBe('he/him')
  })

  it('accepts every pair in the closed set', () => {
    for (const p of ['he/him', 'she/her', 'they/them', 'it/its'] as const) {
      const r = withNpc({ pronouns: p })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.npcs[0].pronouns).toBe(p)
    }
  })

  it('drops anything outside the set rather than passing prose through', () => {
    // A model handed an open field eventually writes "male" or a whole sentence; either would be
    // rendered verbatim into the narrator's roster as "Maren Foss (male)".
    for (const bad of ['male', 'feminine', 'he', 'He/Him ', 42, null]) {
      const r = withNpc({ pronouns: bad })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.npcs[0].pronouns).toBe('')
    }
  })

  it('is absent, never guessed, when the author omitted it', () => {
    // Inferring from the name in CODE would reproduce the exact bug the field exists to fix - a
    // narrator reading "Maren" as female and switching pronouns mid-run.
    const r = withNpc({ pronouns: undefined })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.npcs[0].pronouns).toBe('')
  })
})

describe('stage 4 split into two calls', () => {
  // One call for a 13-row chapter ran 94-147s against a 150s kill and failed four generations
  // running; the same code cleared the lab's 8-10 row chapters in 49s. The halves must add up to
  // exactly what the whole reply produced, or the split has changed the guide rather than its size.
  const whole = JSON.parse(STAGE4_RESPONSE)
  const castDoc = JSON.stringify({ npcs: whole.npcs, locations: whole.locations })
  const fillingDoc = JSON.stringify({ coop_sets: whole.coop_sets, ingredients: whole.ingredients })

  it('parses a cast-only reply, and still holds it to the registry', () => {
    const result = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.npcs.map((n) => n.role)).toContain('boss')
    expect(result.data.ingredients).toEqual([])
  })

  it('fails a cast-only reply that skips a required location', () => {
    const missing = JSON.parse(castDoc)
    missing.locations = missing.locations.slice(0, 1)
    const result = parseStage4Cast(JSON.stringify(missing), STAGE4_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('is missing from the response'))).toBe(true)
  })

  it('parses an ingredients-only reply against the cast it was handed', () => {
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const result = parseStage4Ingredients(fillingDoc, STAGE4_CONTEXT, cast.data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.ingredients).toHaveLength(6)
    expect(result.data.npcs).toEqual(cast.data.npcs)
  })

  it('still rejects a placement key the cast does not contain', () => {
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    if (!cast.ok) throw new Error('fixture cast should parse')
    const broken = fillingDoc.replace('"npc_key":"npc:tam"', '"npc_key":"npc:nobody"')
    const result = parseStage4Ingredients(broken, STAGE4_CONTEXT, cast.data)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('npc:nobody'))).toBe(true)
  })

  it('tells the clue writer who is dead, who the villain is, and what people want', () => {
    // The cast call knew all of this; handing the clue call only a description let it put a clue
    // that comes out in CONVERSATION into a corpse's pocket.
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    if (!cast.ok) throw new Error('fixture cast should parse')
    const dead = { ...cast.data.npcs[1], initialState: 'dead' as const }
    const { user } = buildStage4IngredientsPrompt(STAGE4_CONTEXT, {
      npcs: [{ ...cast.data.npcs[0], role: 'boss' as const }, dead],
      locations: cast.data.locations,
    })
    expect(user).toContain('the chapter villain')
    expect(user).toContain('DEAD')
    expect(user).toContain('Wants:')
  })

  it('warns about a clue that sits nowhere at all', () => {
    // Live play writes ingredients.discovered from exactly two queries - by location_id when the
    // party searches, by npc_id in conversation - so a clue with neither is unreachable by
    // construction. 118 of 637 stored ingredients were in that state.
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    if (!cast.ok) throw new Error('fixture cast should parse')
    const doc = JSON.parse(fillingDoc)
    doc.ingredients[0].placement = { condition: null }
    const result = parseStage4Ingredients(JSON.stringify(doc), STAGE4_CONTEXT, cast.data)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.warnings.some((w) => w.includes('sits nowhere'))).toBe(true)
  })

  it('warns when a clue is placed on someone who cannot be talked to', () => {
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    if (!cast.ok) throw new Error('fixture cast should parse')
    const doc = JSON.parse(fillingDoc)
    const target = doc.ingredients.find((i: { placement: { npc_key?: string } }) => i.placement?.npc_key)
    target.placement = { npc_key: target.placement.npc_key }
    const buried = cast.data.npcs.map((n) =>
      n.key === target.placement.npc_key ? { ...n, initialState: 'dead' as const } : n)
    const result = parseStage4Ingredients(JSON.stringify(doc), STAGE4_CONTEXT, { ...cast.data, npcs: buried })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.warnings.some((w) => w.includes('cannot be reached'))).toBe(true)
  })

  it('halves add up to the whole reply', () => {
    const cast = parseStage4Cast(castDoc, STAGE4_CONTEXT)
    const one = parseStage4(STAGE4_RESPONSE, STAGE4_CONTEXT)
    if (!cast.ok || !one.ok) throw new Error('fixture should parse')
    const filling = parseStage4Ingredients(fillingDoc, STAGE4_CONTEXT, cast.data)
    if (!filling.ok) throw new Error('filling should parse')
    expect({ ...cast.data, coopSets: filling.data.coopSets, ingredients: filling.data.ingredients })
      .toEqual({ ...one.data, warnings: cast.data.warnings })
  })
})

describe('stage 4 (ingredients + coop sets)', () => {
  it('parses the full output and resolves local keys', () => {
    const result = parseStage4(STAGE4_RESPONSE, STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.npcs.map((n) => n.role)).toContain('boss')
    // The lightweight combat seed rides along for the pipeline to derive a stat block from.
    expect(result.data.npcs[0].combat).toEqual({ cr: '4', archetype: 'caster', skills: ['Religion', 'Persuasion'], attack: 'Tidecaller Staff' })
    expect(result.data.ingredients).toHaveLength(6)
    expect(result.data.ingredients[0].objectiveIndexes).toEqual([0])
  })

  it('trims an over-generous ingredient pool instead of failing the chapter', () => {
    // Live 2026-07-31: glm-5.2 answered an ask of 4-6 with 14 ingredients - complete, well-formed,
    // right cast - and the chapter was thrown away twice at 84s a call.
    const doc = JSON.parse(STAGE4_RESPONSE)
    const spare = { ...doc.ingredients[0], coop_set_key: null }
    doc.ingredients = [...doc.ingredients, ...Array.from({ length: 8 }, () => ({ ...spare }))]
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.ingredients).toHaveLength(12)
    expect(result.data.warnings.some((w) => w.includes('the last 2 were dropped'))).toBe(true)
  })

  it('still fails a chapter with too few ingredients to play', () => {
    const doc = JSON.parse(STAGE4_RESPONSE)
    doc.ingredients = doc.ingredients.slice(0, 2)
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('$.ingredients'))).toBe(true)
  })

  it('demotes a coop set missing its pooled conclusion instead of failing the chapter', () => {
    // Live 2026-07-31: a solo adventure - told not to author coop content at all - lost a chapter
    // to `$.coop_sets[0].reveals: expected a non-empty string` after a 111s call.
    const doc = JSON.parse(STAGE4_RESPONSE)
    const key = doc.coop_sets[0].key
    doc.coop_sets[0].reveals = '  '
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.coopSets.some((s) => s.key === key)).toBe(false)
    expect(result.data.ingredients.every((i) => i.coopSetKey !== key)).toBe(true)
    expect(result.data.warnings.some((w) => w.includes('reveals'))).toBe(true)
  })

  it('demotes a coop set whose kind is unrecognised', () => {
    const doc = JSON.parse(STAGE4_RESPONSE)
    doc.coop_sets[0].kind = 'group_puzzle'
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.warnings.some((w) => w.includes('kind'))).toBe(true)
  })

  it('rejects unknown placement / coop keys', () => {
    const broken = STAGE4_RESPONSE.replace('"npc_key":"npc:tam"', '"npc_key":"npc:nobody"')
    const result = parseStage4(broken, STAGE4_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('npc:nobody'))).toBe(true)
  })

  it('accepts existing-chapter keys for placement', () => {
    const ctx = {
      ...STAGE4_CONTEXT,
      existingNpcs: [{ key: 'npc:old-friend', name: 'Old Friend' }],
      existingLocations: [],
    }
    const patched = STAGE4_RESPONSE.replace('"npc_key":"npc:tam"', '"npc_key":"npc:old-friend"')
    expect(parseStage4(patched, ctx).ok).toBe(true)
  })

  it('warns (not fails) when min_players > 1 and no coop set survives', () => {
    const withoutCoop = JSON.parse(STAGE4_RESPONSE)
    withoutCoop.coop_sets = []
    withoutCoop.ingredients = withoutCoop.ingredients.map(
      (i: { coop_set_key: string | null }) => ({ ...i, coop_set_key: null }),
    )
    const result = parseStage4(JSON.stringify(withoutCoop), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.warnings.some((w) => w.includes('min_players'))).toBe(true)
  })

  it('drops coop sets whole in a solo adventure instead of conformance-checking them', () => {
    // Live 2026-07-31 on a min_players=1 one-shot: the model authored three sets, two were demoted
    // for members lacking a reveals_to - a rule the solo prompt never states, because it tells the
    // model not to author coop content at all - and the third, a complementary_obstacle needing two
    // characters at once, survived into a one-player guide.
    const result = parseStage4(STAGE4_RESPONSE, { ...STAGE4_CONTEXT, seed: SOLO_SEED })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.coopSets).toEqual([])
    expect(result.data.ingredients.every((i) => i.coopSetKey === null)).toBe(true)
    expect(result.data.warnings.some((w) => w.includes('can be played solo'))).toBe(true)
    // One note about the whole thing, not one verdict per set.
    expect(result.data.warnings.filter((w) => w.includes('demoted')).length).toBe(0)
  })

  it('allows a coop-free chapter for a solo adventure without warnings', () => {
    const withoutCoop = JSON.parse(STAGE4_RESPONSE)
    withoutCoop.coop_sets = []
    withoutCoop.ingredients = withoutCoop.ingredients.map(
      (i: { coop_set_key: string | null }) => ({ ...i, coop_set_key: null }),
    )
    const result = parseStage4(JSON.stringify(withoutCoop), { ...STAGE4_CONTEXT, seed: SOLO_SEED })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.warnings).toEqual([])
  })

  it('CLEARS a condition that is a conversational trigger, not a check', () => {
    // `filterReveals` gates any conditioned ingredient on a PASSED CHECK and never reads the text,
    // so "asked why she suspects irregularities" locks the clue behind a roll a conversation never
    // makes. Live: every NPC-placed clue across three runs carried such a condition and NPC reveals
    // totalled zero, the one refusal reading `condition not met: asked why she suspects...`.
    const doc = JSON.parse(STAGE4_RESPONSE)
    doc.ingredients[0].placement = { npc_key: 'npc:harbormaster-quill', condition: 'asked about the money' }
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.ingredients[0].placement.condition).toBeUndefined()
    expect(result.data.warnings.some((w) => w.includes('asked about the money'))).toBe(true)
  })

  it('KEEPS a condition that names a real check', () => {
    const doc = JSON.parse(STAGE4_RESPONSE)
    doc.ingredients[0].placement = { npc_key: 'npc:harbormaster-quill', condition: 'successful DC 16 insight' }
    const result = parseStage4(JSON.stringify(doc), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.ingredients[0].placement.condition).toBe('successful DC 16 insight')
  })

  it('demotes a nonconforming split_knowledge set instead of failing (repair + warn)', () => {
    // Make the coop member a secret without an affinity - the exact live stage-4 failure mode.
    const broken = JSON.parse(STAGE4_RESPONSE) as {
      coop_sets: { key: string }[]
      ingredients: { coop_set_key: string | null; type: string; reveals_to: unknown }[]
    }
    const coopKey = broken.coop_sets[0].key
    for (const ing of broken.ingredients) {
      if (ing.coop_set_key === coopKey) {
        ing.type = 'secret'
        ing.reveals_to = null
        break
      }
    }
    const result = parseStage4(JSON.stringify(broken), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.coopSets.map((s) => s.key)).not.toContain(coopKey)
    // Members stay as plain ingredients, detached from the demoted set.
    expect(result.data.ingredients.every((i) => i.coopSetKey !== coopKey)).toBe(true)
    expect(result.data.warnings.some((w) => w.includes(coopKey) && w.includes('demoted'))).toBe(true)
  })

  it('an unmade required PERSON is reclassified as lore, not a stage failure', () => {
    // Drop Harbormaster Quill from the NPC rows; he is a required entity. Stage 4 declining to
    // make a person is now read as "stage 1 mis-filed a group", because that is what it has
    // meant every time it happened live - and failing the stage instead deadlocked generation.
    const missing = JSON.parse(STAGE4_RESPONSE)
    missing.npcs = missing.npcs.filter((n: { name: string }) => n.name !== 'Harbormaster Quill')
    // ...and the clue placed on him, or the dangling placement ref fails the stage for an
    // unrelated (and correct) reason, which would make this test prove nothing.
    missing.ingredients = missing.ingredients.filter(
      (i: { placement?: { npc_key?: string } }) => i.placement?.npc_key !== 'npc:harbormaster-quill')
    const result = parseStage4(JSON.stringify(missing), STAGE4_CONTEXT)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.reclassifyAsLore).toContain('Harbormaster Quill')
      expect(result.data.warnings.join(' ')).toContain('Harbormaster Quill')
    }
  })

  it('but an unmade required PLACE still fails the stage', () => {
    const missing = JSON.parse(STAGE4_RESPONSE)
    missing.locations = []
    const result = parseStage4(JSON.stringify(missing), STAGE4_CONTEXT)
    expect(result.ok).toBe(false)
  })
})

describe('entity coverage (SS2.1)', () => {
  it('matches names leniently (substring after normalization)', () => {
    expect(entityNameMatches('High Priestess Lyra', 'Lyra')).toBe(true)
    expect(entityNameMatches('Mount Cinderpeak', 'cinderpeak')).toBe(true)
    expect(entityNameMatches('Xyloth', 'Volgarth')).toBe(false)
  })

  it('reports every uncovered required entity by name and kind', () => {
    const { errors, reclassifyAsLore } = validateEntityCoverage(
      [
        { kind: 'npc', name: 'Xyloth', note: 'lich' },
        { kind: 'location', name: 'Mount Cinderpeak', note: 'volcano' },
      ],
      ['Some Other NPC'],
      ['Mount Cinderpeak Summit'],
    )
    // The location matched leniently; the missing NPC is a reclassification, not an error.
    expect(errors).toHaveLength(0)
    expect(reclassifyAsLore.map((e) => e.name)).toEqual(['Xyloth'])
  })
})

describe('coop conformance (SS4.1)', () => {
  const clue = (key: string | null, affinity: boolean) => ({
    type: 'clue' as const,
    content: {},
    placement: {},
    reveals: '',
    pillarTags: ['social' as const],
    revealsTo: affinity ? { skill: 'religion' } : null,
    coopSetKey: key,
    objectiveIndexes: [0],
  })

  it('caps coop-demanding obstacles at 1 per 3 objectives', () => {
    expect(maxCoopDemanding(2)).toBe(0)
    expect(maxCoopDemanding(3)).toBe(1)
    expect(maxCoopDemanding(6)).toBe(2)
    const sets = [
      { key: 'a', kind: 'complementary_obstacle' as const, reveals: 'x' },
      { key: 'b', kind: 'complementary_obstacle' as const, reveals: 'x' },
    ]
    const ingredients = [clue('a', false), clue('b', false)]
    const errors = validateCoopConformance({ coopSets: sets, ingredients }, 2, 3)
    expect(errors.some((e) => e.includes('density guardrail'))).toBe(true)
    expect(validateCoopConformance({ coopSets: sets.slice(0, 1), ingredients: [clue('a', false)] }, 2, 3)).toEqual([])
  })

  it('requires split-knowledge sets to have 2-3 clue members with affinities', () => {
    const set = [{ key: 's', kind: 'split_knowledge' as const, reveals: 'the truth' }]
    expect(
      validateCoopConformance({ coopSets: set, ingredients: [clue('s', true)] }, 2, 3).some((e) =>
        e.includes('2-3 member'),
      ),
    ).toBe(true)
    expect(
      validateCoopConformance({ coopSets: set, ingredients: [clue('s', true), clue('s', false)] }, 2, 3).some((e) =>
        e.includes('reveals_to'),
      ),
    ).toBe(true)
    expect(
      validateCoopConformance({ coopSets: set, ingredients: [clue('s', true), clue('s', true)] }, 2, 3),
    ).toEqual([])
  })
})

describe('stage 5 (encounters + budget)', () => {
  it('parses encounters and attaches a budget verdict to battles', () => {
    const result = parseStage5(STAGE5_RESPONSE, STAGE5_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const battle = result.data.encounters.find((e) => e.type === 'battle')!
    expect(battle.budget).not.toBeNull()
    // 4x CR 1/8 = 100 XP raw, x2 multiplier = 200 adjusted vs budget 150 (3 players, lvl 1,
    // standard) - within the 60-140% band.
    expect(battle.budget!.adjustedXp).toBe(200)
    expect(battle.budget!.verdict).toBe('within')
    expect(result.data.encounters.find((e) => e.type === 'social')!.budget).toBeNull()
  })

  it('downgrades a single too-strong creature down the CR ladder instead of shipping a TPK', () => {
    // Body-dropping cannot fix one oversized monster; the old shape shipped "STILL over 3x -
    // swap it by hand" and the near-certain party kill with it. Now the CR walks down until
    // the encounter fits under the lethal ceiling - deterministic, no call, always terminates.
    const oversized = JSON.parse(STAGE5_RESPONSE)
    const battle = oversized.encounters.find((e: { type: string }) => e.type === 'battle')
    battle.enemies = [{ name: 'Ancient Wyrm', cr: '8', count: 1 }]
    const result = parseStage5(JSON.stringify(oversized), STAGE5_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rebalanced = result.data.encounters.find((e) => e.type === 'battle')!
    expect(rebalanced.budget!.adjustedXp).toBeLessThanOrEqual(rebalanced.budget!.xpBudget * 3)
    expect(result.data.warnings.some((w) => w.includes('downgraded Ancient Wyrm CR 8 ->'))).toBe(true)
    expect(result.data.warnings.some((w) => w.includes('STILL over'))).toBe(false)
  })

  it('requires a boss_update for every boss NPC in context', () => {
    const withoutBoss = JSON.parse(STAGE5_RESPONSE)
    withoutBoss.boss_updates = []
    const result = parseStage5(JSON.stringify(withoutBoss), STAGE5_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('npc:mother-brine'))).toBe(true)
  })

  it('keeps a boss whose phases were omitted, and says so', () => {
    // Live 2026-07-31: "$.boss_updates[0].boss_phases: expected an array of length 1-5" discarded a
    // chapter on the stage AFTER stage 4 had spent six attempts getting through. Nothing reads
    // npcs.boss_phases - not session, not combat, not the frontend - so a fight with no authored
    // threshold shifts plays identically to one with them.
    const noPhases = JSON.parse(STAGE5_RESPONSE)
    noPhases.boss_updates[0].boss_phases = []
    const result = parseStage5(JSON.stringify(noPhases), STAGE5_CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.bossUpdates[0].npcKey).toBe('npc:mother-brine')
    expect(result.data.warnings.some((w) => w.includes('no boss_phases'))).toBe(true)
  })

  it('rejects battles with no enemies and unknown location keys', () => {
    const broken = JSON.parse(STAGE5_RESPONSE)
    broken.encounters[0].enemies = []
    broken.encounters[1].location_key = 'loc:atlantis'
    const result = parseStage5(JSON.stringify(broken), STAGE5_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('enemies'))).toBe(true)
      expect(result.errors.some((e) => e.includes('loc:atlantis'))).toBe(true)
    }
  })
})

describe('stage 6 (hooks + quest contracts)', () => {
  it('parses hooks and validates handles', () => {
    const result = parseStage6(STAGE6_RESPONSE, buildTestDigest())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hooks).toHaveLength(3)
    expect(result.data.hooks[2]).toMatchObject({ kind: 'backstory_slot', fromHandle: null })
  })

  it('rejects unknown handles and non-null backstory sources', () => {
    const broken = JSON.parse(STAGE6_RESPONSE)
    broken.hooks[0].from = 'npc#42'
    broken.hooks[2].from = 'npc#1'
    const result = parseStage6(JSON.stringify(broken), buildTestDigest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('npc#42'))).toBe(true)
      expect(result.errors.some((e) => e.includes('must be null'))).toBe(true)
    }
  })

  it('parses the entry contract with resolved refs and bounds (F04 SS4.3)', () => {
    const result = parseStage6(STAGE6_RESPONSE, buildTestDigest())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.contracts).toHaveLength(1)
    expect(result.data.contracts[0]).toMatchObject({
      isEntry: true, giverHandle: 'npc#2', goldFloor: 40, goldCeiling: 90,
      objectiveHandles: ['obj#1', 'obj#2'],
    })
  })

  it('fails on a dangling contract ref, an inverted reward, or a missing entry', () => {
    const badGiver = JSON.parse(STAGE6_RESPONSE)
    badGiver.contracts[0].giver = 'npc#42'
    const giverResult = parseStage6(JSON.stringify(badGiver), buildTestDigest())
    expect(giverResult.ok).toBe(false)

    const badReward = JSON.parse(STAGE6_RESPONSE)
    badReward.contracts[0].gold_ceiling = 10
    const rewardResult = parseStage6(JSON.stringify(badReward), buildTestDigest())
    expect(rewardResult.ok).toBe(false)
    if (!rewardResult.ok) expect(rewardResult.errors.some((e) => e.includes('gold_ceiling'))).toBe(true)

    const noEntry = JSON.parse(STAGE6_RESPONSE)
    noEntry.contracts[0].is_entry = false
    const entryResult = parseStage6(JSON.stringify(noEntry), buildTestDigest())
    expect(entryResult.ok).toBe(false)
    if (!entryResult.ok) expect(entryResult.errors.some((e) => e.includes('is_entry'))).toBe(true)
  })

  it('rejects an entry giver outside the first-chapter/global set (guided retry, not job failure)', () => {
    // Fixture's entry giver is npc#2; a valid-giver list without it must fail the PARSE with a
    // message naming the legal handles - the in-invocation retry can act on that, where the old
    // post-parse edge throw could not (live multi-chapter failure 2026-07-22).
    const result = parseStage6(STAGE6_RESPONSE, buildTestDigest(), ['npc#1'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('first-chapter or global') && e.includes('npc#1'))).toBe(true)

    const allowed = parseStage6(STAGE6_RESPONSE, buildTestDigest(), ['npc#1', 'npc#2'])
    expect(allowed.ok).toBe(true)
  })
})

describe('stage 7 (consistency warnings)', () => {
  it('keeps known targets and degrades unknown handles to guide-level', () => {
    const result = parseStage7(STAGE7_RESPONSE, buildTestDigest())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].targetHandle).toBe('obj#2')
    expect(result.data[1].targetHandle).toBeNull()
  })

  it('accepts an empty warning list', () => {
    const result = parseStage7('{ "warnings": [] }', buildTestDigest())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('registry coverage warns on a global entity that never landed (F04 SS2.1)', () => {
    const globals = [
      { kind: 'npc' as const, name: 'Mother Brine', note: 'antagonist' },
      { kind: 'npc' as const, name: 'The Forgotten Twin', note: 'never used' },
    ]
    const warnings = validateRegistryCoverage(globals, [], ['Mother Brine'], [])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('The Forgotten Twin')
  })

  it('registry coverage counts a chapter-list appearance as covered', () => {
    const globals = [{ kind: 'location' as const, name: 'The Sunken Chapel', note: 'finale' }]
    const warnings = validateRegistryCoverage(globals, [{ kind: 'location', name: 'The Sunken Chapel', note: '' }], [], [])
    expect(warnings).toEqual([])
  })
})


describe('stage 8 (ending designer)', () => {
  it('parses dials + 3-5 candidate endings with closed-vocabulary signals', () => {
    const result = parseStage8Fixture(STAGE8_RESPONSE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.dials.map((d) => d.key)).toEqual(['mercy', 'town_warned'])
    expect(result.data.endings).toHaveLength(3)
    expect(result.data.endings[0].triggerConditions.signals[2].weight).toBe(-4)
    expect(result.data.endings.map((e) => e.tone)).toEqual(['pyrrhic', 'bittersweet', 'tragic'])
    // Signal refs are the closed vocabulary, not free-form predicates.
    expect(result.data.endings[0].triggerConditions.signals[0].when).toEqual({ npc: 1, state: 'dead' })
  })

  it('rejects too few endings, out-of-range refs, unknown dials, and bad weights', () => {
    const tooFew = JSON.parse(STAGE8_RESPONSE)
    tooFew.endings = tooFew.endings.slice(0, 2)
    expect(parseStage8Fixture(JSON.stringify(tooFew)).ok).toBe(false)

    // An objective number past the count is a hard failure (dangling ref).
    const badObjective = JSON.parse(STAGE8_RESPONSE)
    badObjective.endings[0].trigger_conditions.signals[1].when = { objective: 99, outcome: 'completed' }
    const objResult = parseStage8Fixture(JSON.stringify(badObjective))
    expect(objResult.ok).toBe(false)
    if (!objResult.ok) expect(objResult.errors.some((e) => e.includes('objective number'))).toBe(true)

    const unknownDial = JSON.parse(STAGE8_RESPONSE)
    unknownDial.endings[0].trigger_conditions.signals[2].when = { dial: 'not_a_dial', gte: 2 }
    const dialResult = parseStage8Fixture(JSON.stringify(unknownDial))
    expect(dialResult.ok).toBe(false)
    if (!dialResult.ok) expect(dialResult.errors.some((e) => e.includes('not a declared dial'))).toBe(true)

    const badWeight = JSON.parse(STAGE8_RESPONSE)
    badWeight.endings[1].trigger_conditions.signals[0].weight = 0
    expect(parseStage8Fixture(JSON.stringify(badWeight)).ok).toBe(false)
  })

  it('rejects a dial signal with both or neither of gte/lte', () => {
    const both = JSON.parse(STAGE8_RESPONSE)
    both.endings[0].trigger_conditions.signals[2].when = { dial: 'mercy', gte: 2, lte: 4 }
    expect(parseStage8Fixture(JSON.stringify(both)).ok).toBe(false)
  })

  it('distinctness: clean fixture produces no warnings', () => {
    const parsed = parseStage8Fixture(STAGE8_RESPONSE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateEndingDistinctness(parsed.data.endings)).toEqual([])
  })

  it('distinctness: flags no-positive-signal endings and duplicates', () => {
    const parsed = parseStage8Fixture(STAGE8_RESPONSE)
    if (!parsed.ok) throw new Error('fixture must parse')
    const [a, b, c] = parsed.data.endings

    const noPositive = {
      ...b,
      triggerConditions: {
        summary: '',
        signals: [{ when: { objective: 3, outcome: 'completed' as const }, weight: -2, note: '' }],
      },
    }
    const duplicate = { ...c, title: a.title, tone: a.tone }
    const warnings = validateEndingDistinctness([a, noPositive, duplicate])
    expect(warnings.some((w) => w.includes('argue FOR'))).toBe(true)
    expect(warnings.some((w) => w.includes('duplicates'))).toBe(true)
  })

  it('reachability: flags dial-only endings and a climax that decides nothing', () => {
    const parsed = parseStage8Fixture(STAGE8_RESPONSE)
    if (!parsed.ok) throw new Error('fixture must parse')
    const [a, b] = parsed.data.endings

    const dialOnly = {
      ...b,
      triggerConditions: {
        summary: '',
        signals: [{ when: { dial: 'mercy', gte: 3 }, weight: 3, note: '' }],
      },
    }
    const warnings = validateEndingReachability([a, dialOnly], STAGE8_OBJECTIVE_COUNT)
    expect(warnings.some((w) => w.includes('no objective signal'))).toBe(true)

    const climaxRef = {
      ...a,
      triggerConditions: {
        summary: '',
        signals: [{ when: { objective: STAGE8_OBJECTIVE_COUNT, outcome: 'completed' as const }, weight: 3, note: '' }],
      },
    }
    // Claims the victory branch only, so a party that LOSES the climax has no ending that is
    // true of their run (2026-07-28).
    expect(validateEndingReachability([climaxRef], STAGE8_OBJECTIVE_COUNT))
      .toEqual([`No ending positively claims the climax (#${STAGE8_OBJECTIVE_COUNT}) failed - a run that ends that way has no ending that matches it.`])

    expect(
      validateEndingReachability(
        [{ ...a, triggerConditions: { summary: '', signals: [{ when: { objective: 1, outcome: 'completed' as const }, weight: 3, note: '' }] } }],
        STAGE8_OBJECTIVE_COUNT,
      ).some((w) => w.includes('final objective')),
    ).toBe(true)
  })

  it('reachability: both climax branches need an ending, and a negative claim is not one', () => {
    const parsed = parseStage8Fixture(STAGE8_RESPONSE)
    if (!parsed.ok) throw new Error('fixture must parse')
    const [a, b] = parsed.data.endings
    const claiming = (ending: typeof a, outcome: 'completed' | 'failed', weight: number) => ({
      ...ending,
      triggerConditions: {
        summary: '',
        signals: [{ when: { objective: STAGE8_OBJECTIVE_COUNT, outcome }, weight, note: '' }],
      },
    })

    expect(
      validateEndingReachability([claiming(a, 'completed', 4), claiming(b, 'failed', 4)], STAGE8_OBJECTIVE_COUNT),
    ).toEqual([])

    // A NEGATIVE climax signal says what would argue AGAINST this ending - it does not give the
    // failure branch a home, and the finale would have nothing truthful to hand a losing party.
    expect(
      validateEndingReachability([claiming(a, 'completed', 4), claiming(b, 'failed', -4)], STAGE8_OBJECTIVE_COUNT)
        .some((w) => w.includes('failed')),
    ).toBe(true)
  })
})

describe('stage 4 established-entity contract', () => {
  // Live 2026-07-21: stage 4 runs per chapter and used to see only names, so a later chapter
  // made Elara Voss the victim's wife, his poisoner, AND the servant framing someone else.
  it('carries facts from earlier chapters into the prompt, not just names', () => {
    const { user } = buildStage4CastPrompt({
      ...STAGE4_CONTEXT,
      existingNpcs: [{
        key: 'npc:elara',
        name: 'Elara Voss',
        facts: ['wife of the victim', 'is dead when play begins'],
      }],
      existingLocations: [],
    })
    expect(user).toContain('never author anything that contradicts it')
    expect(user).toContain('Elara Voss')
    expect(user).toContain('wife of the victim')
    expect(user).toContain('is dead when play begins')
  })

  it('says nothing about existing entities in the first chapter', () => {
    const { user } = buildStage4CastPrompt({ ...STAGE4_CONTEXT, existingNpcs: [], existingLocations: [] })
    expect(user).not.toContain('never author anything that contradicts it')
  })
})

describe('lore entities are context, not rows (2026-07-23)', () => {
  it('does NOT demand a row for a faction or a force', () => {
    // Before this, the coverage contract fell through to the location pool for any non-npc
    // kind, so "the Iron Hand Guild" had to be materialized - and the only bucket for a group
    // was the npcs table.
    const errors = validateEntityCoverage(
      [
        { kind: 'lore', name: 'The Iron Hand Guild', note: 'the smuggling ring' },
        { kind: 'lore', name: 'The Blight', note: 'the spreading corruption' },
      ],
      [], [],
    ).errors
    expect(errors).toEqual([])
  })

  it('demands rows for places, and reclassifies unmade people as lore', () => {
    // The deadlock this replaces (live 2026-07-23, The Tidewater Vault): stage 1 filed
    // "Silver Scale Guild guards" as an npc, stage 4 refused to make a group into a person,
    // the contract demanded the row anyway, and generation died after four retries.
    const { errors, reclassifyAsLore } = validateEntityCoverage(
      [
        { kind: 'npc', name: 'Sereth Vane', note: 'the harbormistress' },
        { kind: 'location', name: 'The Quay', note: 'the harbor' },
      ],
      [], [],
    )
    expect(errors).toHaveLength(1)
    expect(errors.join(' ')).toContain('The Quay')
    expect(reclassifyAsLore.map((e) => e.name)).toEqual(['Sereth Vane'])
  })

  it('a mixed registry only requires the materializing kinds', () => {
    const { errors, reclassifyAsLore } = validateEntityCoverage(
      [
        { kind: 'npc', name: 'Sereth Vane', note: 'the harbormistress' },
        { kind: 'lore', name: "Valerius's Agents", note: 'the squad hunting the witness' },
      ],
      ['Sereth Vane'], [],
    )
    expect(errors).toEqual([])
    expect(reclassifyAsLore).toEqual([])
  })
})

describe('an absent NPC cannot carry a rapport signal (2026-07-28)', () => {
  // Live: three of four endings in one guide rested on The Drowned Creditor turning hostile or
  // allied - an NPC authored `absent`. The lint caught it, recorded it as `info`, and shipped, so
  // three quarters of the endings were kneecapped before a turn was played.
  const ending = (title: string, extraSignal: Record<string, unknown> | null) => ({
    title, tone: 'tragic', description: `${title} resolution.`, climax_summary: `${title} sketch.`,
    trigger_conditions: {
      signals: [
        { when: { objective: 1, outcome: 'completed' }, weight: 5, note: 'the climax' },
        ...(extraSignal ? [extraSignal] : []),
      ],
    },
  })
  const body = (state: string) => JSON.stringify({
    endings: [
      ending('The Ledger Burns', { when: { npc: 2, state }, weight: 3, note: 'the creditor' }),
      ending('A New Ledger', null),
      ending('The Final Tide', null),
    ],
    dials: [{ key: 'mercy', name: 'Mercy vs ruthlessness' }, { key: 'debt', name: 'Debt vs freedom' }],
  })

  it('rejects allied/hostile for someone who never appears', () => {
    for (const state of ['allied', 'hostile']) {
      const res = parseStage8(body(state), 1, 2, new Set([2]))
      if (res.ok) throw new Error(`expected ${state} on an absent NPC to be rejected`)
      expect(res.errors.join(' ')).toContain('never appears')
    }
  })

  it('still allows dead/alive for them - an absent person can die offstage', () => {
    for (const state of ['dead', 'alive']) {
      expect(parseStage8(body(state), 1, 2, new Set([2])).ok).toBe(true)
    }
  })

  it('leaves present NPCs untouched', () => {
    expect(parseStage8(body('allied'), 1, 2, new Set()).ok).toBe(true)
    expect(parseStage8(body('hostile'), 1, 2, new Set([1])).ok).toBe(true)
  })
})
