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
  buildStage4Prompt, entityNameMatches, maxCoopDemanding, parseStage4, validateCoopConformance,
  validateEntityCoverage,
} from './stage4.ts'
import { parseStage5 } from './stage5.ts'
import { parseStage6 } from './stage6.ts'
import { buildStage7EditPlanPrompt, handleTable, parseStage7, parseStage7EditPlan, validateRegistryCoverage } from './stage7.ts'
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

  it('drops registry entities whose kind is not npc/location instead of failing', () => {
    const withFaction = STAGE1_RESPONSE.replace(
      '"entities": [',
      '"entities": [\n    { "kind": "faction", "name": "The Salvagers", "note": "the cult" },',
    )
    const result = parseStage1(withFaction, SEED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.metaLoop.entities?.map((e) => e.kind)).not.toContain('faction')
    expect(result.data.metaLoop.entities?.map((e) => e.name)).not.toContain('The Salvagers')
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

  it('rejects an objective whose predicate has no atom live play can claim (2.1)', () => {
    // Structurally valid (validatePredicate passes) but uncompletable: an eq:false flag is never
    // written by a milestone, so this objective could never finish - it must not ship.
    const result = parseStage3(JSON.stringify({
      objectives: [{
        title: 'Keep the gate shut',
        hidden_description: 'the party must never open it',
        completion_predicates: { flag: 'gate_opened', eq: false },
      }],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('no claimable milestone'))).toBe(true)
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

  it('rejects a response missing a required registry entity (F04 SS2.1)', () => {
    // Drop Harbormaster Quill from the NPC rows; he is a required entity.
    const missing = JSON.parse(STAGE4_RESPONSE)
    missing.npcs = missing.npcs.filter((n: { name: string }) => n.name !== 'Harbormaster Quill')
    const result = parseStage4(JSON.stringify(missing), STAGE4_CONTEXT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('Harbormaster Quill'))).toBe(true)
  })
})

describe('entity coverage (SS2.1)', () => {
  it('matches names leniently (substring after normalization)', () => {
    expect(entityNameMatches('High Priestess Lyra', 'Lyra')).toBe(true)
    expect(entityNameMatches('Mount Cinderpeak', 'cinderpeak')).toBe(true)
    expect(entityNameMatches('Xyloth', 'Volgarth')).toBe(false)
  })

  it('reports every uncovered required entity by name and kind', () => {
    const errors = validateEntityCoverage(
      [
        { kind: 'npc', name: 'Xyloth', note: 'lich' },
        { kind: 'location', name: 'Mount Cinderpeak', note: 'volcano' },
      ],
      ['Some Other NPC'],
      ['Mount Cinderpeak Summit'],
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Xyloth')
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

describe('stage 7 edit plans (auto-resolve consistency findings)', () => {
  const HANDLES = new Set(['obj#1', 'obj#2', 'npc#1', 'loc#1', 'ing#1'])

  it('accepts a multi-row plan and carries notes', () => {
    const result = parseStage7EditPlan(
      JSON.stringify({
        edits: [
          { handle: 'obj#2', patch: { title: 'Face the killer' }, note: 'de-spoiled' },
          { handle: 'npc#1', patch: { description: 'A patient horror, waiting beneath the loom.' }, note: 'aligned to meta loop' },
        ],
      }),
      HANDLES,
      3,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(2)
    expect(result.data[0].patch).toEqual({ title: 'Face the killer' })
    expect(result.data[1].note).toBe('aligned to meta loop')
  })

  it('accepts an empty plan (nothing fixable is a valid answer)', () => {
    const result = parseStage7EditPlan('{ "edits": [] }', HANDLES, 3)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('rejects unknown handles, duplicate handles, and off-whitelist fields', () => {
    const unknown = parseStage7EditPlan(
      '{ "edits": [ { "handle": "obj#9", "patch": { "title": "X" }, "note": "" } ] }', HANDLES, 3)
    expect(unknown.ok).toBe(false)

    const dupe = parseStage7EditPlan(
      JSON.stringify({ edits: [
        { handle: 'obj#2', patch: { title: 'One' }, note: '' },
        { handle: 'obj#2', patch: { title: 'Two' }, note: '' },
      ] }), HANDLES, 3)
    expect(dupe.ok).toBe(false)
    if (!dupe.ok) expect(dupe.errors.some((e) => e.includes('appears twice'))).toBe(true)

    const offWhitelist = parseStage7EditPlan(
      '{ "edits": [ { "handle": "obj#2", "patch": { "completion_predicates": "{}" }, "note": "" } ] }', HANDLES, 3)
    expect(offWhitelist.ok).toBe(false)
  })

  it('holds titles to the word cap and prose to the completeness check', () => {
    const longTitle = parseStage7EditPlan(
      '{ "edits": [ { "handle": "obj#2", "patch": { "title": "Deliver Final Judgment on the Manor Killer" }, "note": "" } ] }',
      HANDLES, 3)
    expect(longTitle.ok).toBe(false)

    const cutOff = parseStage7EditPlan(
      '{ "edits": [ { "handle": "obj#2", "patch": { "hidden_description": "The nectar is a poten" }, "note": "" } ] }',
      HANDLES, 3)
    expect(cutOff.ok).toBe(false)
    if (!cutOff.ok) expect(cutOff.errors.some((e) => e.includes('ends mid-thought'))).toBe(true)
  })

  it('accepts chapter moves: numbers in range, "global" for cast but never for objectives', () => {
    const npcMove = parseStage7EditPlan(
      '{ "edits": [ { "handle": "npc#1", "patch": { "chapter": "3" }, "note": "boss belongs at the climax" } ] }',
      HANDLES, 3)
    expect(npcMove.ok).toBe(true)
    if (npcMove.ok) expect(npcMove.data[0].patch).toEqual({ chapter: '3' })

    const globalLocation = parseStage7EditPlan(
      '{ "edits": [ { "handle": "loc#1", "patch": { "chapter": "global" }, "note": "" } ] }', HANDLES, 3)
    expect(globalLocation.ok).toBe(true)

    const globalObjective = parseStage7EditPlan(
      '{ "edits": [ { "handle": "obj#2", "patch": { "chapter": "global" }, "note": "" } ] }', HANDLES, 3)
    expect(globalObjective.ok).toBe(false)

    const outOfRange = parseStage7EditPlan(
      '{ "edits": [ { "handle": "npc#1", "patch": { "chapter": "7" }, "note": "" } ] }', HANDLES, 3)
    expect(outOfRange.ok).toBe(false)
  })

  it('accepts create entries for missing spine entities, rejecting duplicates and cut-off prose', () => {
    const create = parseStage7EditPlan(
      JSON.stringify({ edits: [{
        create: { kind: 'location', name: 'Boundary Stone', description: 'A weathered marker at the valley edge, half-swallowed by moss.', chapter: '2' },
        note: 'spine entity never landed',
      }] }),
      new Set(['obj#1']), 3, new Set(['flooded mill']),
    )
    expect(create.ok).toBe(true)
    if (!create.ok) return
    expect(create.data[0].create).toMatchObject({ kind: 'location', name: 'Boundary Stone', chapter: '2' })

    const dupe = parseStage7EditPlan(
      JSON.stringify({ edits: [{ create: { kind: 'npc', name: 'Flooded Mill', description: 'A mill.', chapter: '1' }, note: '' }] }),
      new Set(), 3, new Set(['flooded mill']),
    )
    expect(dupe.ok).toBe(false)
    if (!dupe.ok) expect(dupe.errors.some((e) => e.includes('already exists'))).toBe(true)

    const cutOff = parseStage7EditPlan(
      JSON.stringify({ edits: [{ create: { kind: 'npc', name: 'The Loremaster', description: 'Keeper of the poten', chapter: 'global' }, note: '' }] }),
      new Set(), 3, new Set(),
    )
    expect(cutOff.ok).toBe(false)

    const both = parseStage7EditPlan(
      JSON.stringify({ edits: [{ handle: 'obj#1', patch: { title: 'X' }, create: { kind: 'npc', name: 'Y', description: 'Z.', chapter: '1' }, note: '' }] }),
      new Set(['obj#1']), 3, new Set(),
    )
    expect(both.ok).toBe(false)
  })

  it('carries checker severity, defaulting unrated findings to major', () => {
    const result = parseStage7(
    JSON.stringify({ warnings: [
      { target: 'obj#2', severity: 'minor', message: 'could be tighter' },
      { target: 'obj#2', message: 'contradicts the meta loop' },
    ] }),
      buildTestDigest(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].severity).toBe('minor')
    expect(result.data[1].severity).toBe('major')
  })

  it('validates predicate patches structurally: grammar, no facts, claimable', () => {
    const good = parseStage7EditPlan(
      JSON.stringify({ edits: [{ handle: 'obj#1', patch: { completion_predicates: JSON.stringify({ any: [{ flag: 'writ_secured', eq: true }, { event: 'the gate was opened' }] }) }, note: 'result-event removed' }] }),
      new Set(['obj#1']), 3,
    )
    expect(good.ok).toBe(true)
    if (good.ok) expect(JSON.parse(good.data[0].patch.completion_predicates)).toMatchObject({ any: expect.anything() })

    const factAtom = parseStage7EditPlan(
      JSON.stringify({ edits: [{ handle: 'obj#1', patch: { completion_predicates: JSON.stringify({ fact: 'npc.thorne.status', eq: 'dead' }) }, note: '' }] }),
      new Set(['obj#1']), 3,
    )
    expect(factAtom.ok).toBe(false)

    const unclaimable = parseStage7EditPlan(
      JSON.stringify({ edits: [{ handle: 'obj#1', patch: { completion_predicates: JSON.stringify({ flag: 'gate_opened', eq: false }) }, note: '' }] }),
      new Set(['obj#1']), 3,
    )
    expect(unclaimable.ok).toBe(false)

    const notJson = parseStage7EditPlan(
      JSON.stringify({ edits: [{ handle: 'obj#1', patch: { completion_predicates: 'when the party wins' }, note: '' }] }),
      new Set(['obj#1']), 3,
    )
    expect(notJson.ok).toBe(false)
  })

  it('derives the table from the handle grammar', () => {
    expect(handleTable('obj#3')).toBe('objectives')
    expect(handleTable('npc#1')).toBe('npcs')
    expect(handleTable('loc#12')).toBe('locations')
    expect(handleTable('ing#7')).toBe('ingredients')
    expect(handleTable('chapter#1')).toBeNull()
  })

  it('edit-plan prompt carries findings, row contents, chapters, and the cluster guidance', () => {
    const { system, user } = buildStage7EditPlanPrompt({
      warnings: [
        { handle: 'obj#1', message: 'Objective says the party holds the writ' },
        { handle: 'obj#2', message: 'Objective says Thorne seizes the writ' },
      ],
      rowlessWarnings: ['Registry location "Boundary Stone" is named in the story spine but never appears'],
      rows: [
        { handle: 'obj#1', table: 'objectives', fields: { title: 'Secure the writ', hidden_description: 'They hold it.', chapter: '1' } },
        { handle: 'obj#2', table: 'objectives', fields: { title: 'Escape Oakhaven', hidden_description: 'Thorne takes it.', chapter: '3' } },
      ],
      digest: buildTestDigest(),
      metaLoopArc: 'Thorne orchestrates a final confrontation to seize the writ',
      chapters: [{ number: 1, title: 'Arrival' }, { number: 2, title: 'The Vice' }, { number: 3, title: 'The Gate' }],
    })
    expect(system).toContain('ROOT contradiction')
    expect(system).toContain('TIMING or PLACEMENT')
    expect(user).toContain('[obj#1] Objective says the party holds the writ')
    expect(user).toContain('Secure the writ')
    expect(user).toContain('Chapters: 1: Arrival | 2: The Vice | 3: The Gate')
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
    expect(validateEndingReachability([climaxRef], STAGE8_OBJECTIVE_COUNT)).toEqual([])
    expect(
      validateEndingReachability(
        [{ ...a, triggerConditions: { summary: '', signals: [{ when: { objective: 1, outcome: 'completed' as const }, weight: 3, note: '' }] } }],
        STAGE8_OBJECTIVE_COUNT,
      ).some((w) => w.includes('final objective')),
    ).toBe(true)
  })
})

describe('stage 4 established-entity contract', () => {
  // Live 2026-07-21: stage 4 runs per chapter and used to see only names, so a later chapter
  // made Elara Voss the victim's wife, his poisoner, AND the servant framing someone else.
  it('carries facts from earlier chapters into the prompt, not just names', () => {
    const { user } = buildStage4Prompt({
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
    const { user } = buildStage4Prompt({ ...STAGE4_CONTEXT, existingNpcs: [], existingLocations: [] })
    expect(user).not.toContain('never author anything that contradicts it')
  })
})
