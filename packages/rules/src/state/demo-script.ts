// Scripted demo session (DEVELOPMENT-PLAN PHASE 4): a fixed sequence of state diffs that
// walks every scene mode - narration -> roleplay -> battle -> downtime - with dummy content,
// so the three renderers and multi-client sync can be tested without any AI (F07) built.
// The session function's demo_step action applies one step at a time and broadcasts it.

import type { FxEvent, StateDiff, TokenState } from './types.ts'

/** Row ids/urls from the seeded demo adventure, resolved by the driver at run time. */
export interface DemoContext {
  locationId: string
  locationName: string
  backgroundUrl: string | null
  mapUrl: string | null
  obstacles: [number, number][]
  npcs: { id: string; name: string; imageUrl: string | null }[]
  objectives: { id: string; title: string }[]
  party: { userId: string; characterId: string; name: string; imageUrl: string | null }[]
}

export interface DemoStep {
  label: string
  diffs: StateDiff[]
  fx?: FxEvent[]
}

function pcTokens(ctx: DemoContext): TokenState[] {
  return ctx.party.map((p, i) => ({
    id: `pc-${p.characterId}`,
    kind: 'pc' as const,
    refId: p.characterId,
    name: p.name,
    imageUrl: p.imageUrl,
    x: 4 + i * 2,
    y: 26,
    hp: { current: 10, max: 12, temp: 0 },
    conditions: [],
    allegiance: 'party' as const,
    controller: 'player' as const,
    controllerUserId: p.userId,
    speed: 6,
  }))
}

function npcToken(ctx: DemoContext, index: number, x: number, y: number): TokenState {
  const npc = ctx.npcs[index % Math.max(1, ctx.npcs.length)]
  return {
    id: `npc-${npc?.id ?? index}-${index}`,
    kind: 'npc',
    refId: npc?.id ?? `demo-${index}`,
    name: npc?.name ?? 'Bandit',
    imageUrl: npc?.imageUrl ?? null,
    x,
    y,
    hp: { current: 8, max: 8, temp: 0 },
    conditions: [],
    allegiance: 'enemy',
    controller: 'dm',
    controllerUserId: null,
    speed: 6,
  }
}

const asPatch = (value: unknown) => value as StateDiff['patch']

export function buildDemoScript(ctx: DemoContext): DemoStep[] {
  const [npcA, npcB] = [ctx.npcs[0], ctx.npcs[1] ?? ctx.npcs[0]]
  const [objA, objB] = [ctx.objectives[0], ctx.objectives[1] ?? ctx.objectives[0]]
  const tokens = [...pcTokens(ctx), npcToken(ctx, 0, 14, 8), npcToken(ctx, 1, 18, 8)]
  const order = tokens.map((t, i) => ({ tokenId: t.id, roll: 20 - i * 3 }))

  return [
    {
      label: 'Narration: arrival',
      diffs: [
        {
          domain: 'scene',
          patch: asPatch({
            mode: 'narration', activeVisual: 'background', locationId: ctx.locationId,
            locationName: ctx.locationName, backgroundUrl: ctx.backgroundUrl, day: 1,
          }),
        },
        {
          domain: 'dialogue',
          patch: asPatch({
            lines: [{ id: 'd1', speaker: null, npcId: null, text: 'Dusk settles as the party crests the ridge. Below, lanterns flicker in the village square - too few, and too still.' }],
            activeLineId: 'd1',
            speakers: [],
          }),
        },
      ],
    },
    {
      label: 'Narration: the hook',
      diffs: [
        {
          domain: 'dialogue',
          patch: asPatch({
            lines: [
              { id: 'd1', speaker: null, npcId: null, text: 'Dusk settles as the party crests the ridge. Below, lanterns flicker in the village square - too few, and too still.' },
              { id: 'd2', speaker: null, npcId: null, text: 'A figure hurries up the path to meet you, cloak drawn tight against more than the cold.' },
            ],
            activeLineId: 'd2',
          }),
        },
        ...(objA
          ? [{ domain: 'objectives' as const, patch: asPatch({ currentId: objA.id, list: [{ id: objA.id, title: objA.title, state: 'active' }] }) }]
          : []),
      ],
    },
    {
      label: 'Roleplay: village elder',
      diffs: [
        { domain: 'scene', patch: asPatch({ mode: 'roleplay' }) },
        {
          domain: 'dialogue',
          patch: asPatch({
            speakers: [{ npcId: npcA?.id ?? 'demo-a', name: npcA?.name ?? 'Elder', side: 'left', imageUrl: npcA?.imageUrl ?? null }],
            lines: [{ id: 'd3', speaker: npcA?.name ?? 'Elder', npcId: npcA?.id ?? 'demo-a', text: 'Thank the stars you came. They took the miller’s boy at moonrise - the third this month.' }],
            activeLineId: 'd3',
          }),
        },
      ],
    },
    {
      label: 'Roleplay: a second voice',
      diffs: [
        {
          domain: 'dialogue',
          patch: asPatch({
            speakers: [
              { npcId: npcA?.id ?? 'demo-a', name: npcA?.name ?? 'Elder', side: 'left', imageUrl: npcA?.imageUrl ?? null },
              { npcId: npcB?.id ?? 'demo-b', name: npcB?.name ?? 'Stranger', side: 'right', imageUrl: npcB?.imageUrl ?? null },
            ],
            lines: [
              { id: 'd3', speaker: npcA?.name ?? 'Elder', npcId: npcA?.id ?? 'demo-a', text: 'Thank the stars you came. They took the miller’s boy at moonrise - the third this month.' },
              { id: 'd4', speaker: npcB?.name ?? 'Stranger', npcId: npcB?.id ?? 'demo-b', text: 'Save your gratitude. Whatever hunts this village left tracks no beast would leave.' },
            ],
            activeLineId: 'd4',
          }),
        },
        ...(objB && objB.id !== objA?.id
          ? [{
              domain: 'objectives' as const,
              patch: asPatch({
                list: [
                  { id: objA?.id ?? 'o1', title: objA?.title ?? '', state: 'active' },
                  { id: objB.id, title: objB.title, state: 'revealed' },
                ],
              }),
            }]
          : []),
      ],
    },
    {
      label: 'Battle: ambush',
      diffs: [
        { domain: 'scene', patch: asPatch({ mode: 'battle', activeVisual: 'map' }) },
        {
          domain: 'combat',
          patch: asPatch({
            locationId: ctx.locationId,
            mapUrl: ctx.mapUrl,
            obstacles: ctx.obstacles,
            tokens,
            initiative: order,
            round: 1,
            activeTokenId: order[0].tokenId,
            economy: { action: true, bonus: true, move: 6, reaction: true },
          }),
        },
        { domain: 'dialogue', patch: asPatch({ speakers: [], activeLineId: null }) },
      ],
      fx: [{ kind: 'banner', text: 'Roll initiative!' }],
    },
    {
      label: 'Battle: enemy strikes',
      diffs: [
        {
          domain: 'combat',
          patch: asPatch({
            tokens: tokens.map((t) =>
              t.id === tokens[0].id ? { ...t, hp: { current: 6, max: 12, temp: 0 } } : t,
            ),
            activeTokenId: order[1]?.tokenId ?? order[0].tokenId,
            economy: { action: true, bonus: true, move: 6, reaction: true },
          }),
        },
      ],
      fx: [{ kind: 'damage', tokenId: tokens[0].id, value: 4 }],
    },
    {
      label: 'Battle: poisoned!',
      diffs: [
        {
          domain: 'combat',
          patch: asPatch({
            tokens: tokens.map((t, i) =>
              i === 0
                ? { ...t, hp: { current: 6, max: 12, temp: 0 }, conditions: ['poisoned'] }
                : t.id === tokens[tokens.length - 1].id
                  ? { ...t, hp: { current: 2, max: 8, temp: 0 } }
                  : t,
            ),
            round: 2,
            activeTokenId: order[0].tokenId,
            economy: { action: true, bonus: true, move: 6, reaction: true },
          }),
        },
      ],
      fx: [{ kind: 'damage', tokenId: tokens[tokens.length - 1].id, value: 6 }],
    },
    {
      label: 'Battle won',
      diffs: [
        { domain: 'combat', patch: null },
        { domain: 'scene', patch: asPatch({ mode: 'narration', activeVisual: 'background' }) },
        {
          domain: 'dialogue',
          patch: asPatch({
            lines: [{ id: 'd5', speaker: null, npcId: null, text: 'The last attacker crumples. In the sudden quiet, the village bell begins to toll.' }],
            activeLineId: 'd5',
            speakers: [],
          }),
        },
        ...(objA
          ? [{
              domain: 'objectives' as const,
              patch: asPatch({
                list: [
                  { id: objA.id, title: objA.title, state: 'completed' },
                  ...(objB && objB.id !== objA.id ? [{ id: objB.id, title: objB.title, state: 'active' }] : []),
                ],
                currentId: objB && objB.id !== objA.id ? objB.id : objA.id,
              }),
            }]
          : []),
      ],
      fx: [{ kind: 'banner', text: 'Victory' }],
    },
    {
      label: 'Downtime: the tavern',
      diffs: [
        { domain: 'scene', patch: asPatch({ mode: 'downtime', day: 2 }) },
        {
          domain: 'dialogue',
          patch: asPatch({
            lines: [
              { id: 'd6', speaker: null, npcId: null, text: 'The party settles in at the Sleeping Griffin. Rumors are cheap tonight; ale is cheaper.' },
            ],
            activeLineId: 'd6',
          }),
        },
      ],
    },
  ]
}
