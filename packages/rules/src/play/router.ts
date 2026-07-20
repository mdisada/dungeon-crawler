// Action Router (F07 SS3.2): deterministic classification, never an LLM. Fast-path kinds go
// straight to engines; free-text splits between the dialogue pipeline (NPCs staged), free
// player chat (battle/puzzle only), and the Adjudicator. Say with nobody staged in freeform
// scenes goes to the Adjudicator - it is addressed to the DM, and the old chat route answered
// it with silence (the Bloodfire Volcano dead-end, 2026-07-19).

import type { IntentEnvelope, IntentRoute } from './types.ts'

export interface RouterScene {
  mode: string
  stagedNpcIds: string[]
}

const FAST_PATH_KINDS = new Set(['move', 'attack', 'cast', 'use_item'])

export function classifyIntent(intent: Pick<IntentEnvelope, 'kind' | 'skill' | 'targetId'>, scene: RouterScene): IntentRoute {
  if (intent.kind === 'dm_command') return 'dm_command'
  if (FAST_PATH_KINDS.has(intent.kind)) return 'fast_path'
  if (intent.kind === 'roll') {
    // Explicit skill = fast path. A bare "roll" with no skill is really "do something" - the
    // Adjudicator specs the check.
    return intent.skill ? 'fast_path' : 'adjudicate'
  }
  if (intent.kind === 'say') {
    const npcInScene = intent.targetId !== null || scene.stagedNpcIds.length > 0
    if (npcInScene) return 'dialogue'
    // Mid-encounter table talk stays chat; everywhere else the DM answers via the Adjudicator.
    return scene.mode === 'battle' || scene.mode === 'puzzle' ? 'chat' : 'adjudicate'
  }
  return 'adjudicate'
}
