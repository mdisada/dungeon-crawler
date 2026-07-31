import { describe, expect, it } from 'vitest'

import {
  AGENT_ROLE_LABELS,
  PRIMARY_MODEL,
  ROLES_BY_TIER,
  SECONDARY_MODEL,
  SYSTEM_DEFAULT_MODEL_MAP,
  expandTiers,
  isAgentRole,
  resolveModel,
  tierOfRole,
  tiersFromMap,
} from './model-routing'

describe('resolveModel', () => {
  it('falls back to the system default when the role has no override', () => {
    expect(resolveModel('narrator', {})).toBe(SYSTEM_DEFAULT_MODEL_MAP.narrator)
  })

  it('prefers a user override over the system default', () => {
    const override = { narrator: 'mistralai/mistral-nemo' }
    expect(resolveModel('narrator', override)).toBe('mistralai/mistral-nemo')
  })

  it('ignores overrides for other roles', () => {
    const override = { adjudicator: 'mistralai/mistral-nemo' }
    expect(resolveModel('narrator', override)).toBe(SYSTEM_DEFAULT_MODEL_MAP.narrator)
  })
})

describe('isAgentRole', () => {
  it('accepts every role with a system default', () => {
    for (const role of Object.keys(SYSTEM_DEFAULT_MODEL_MAP)) {
      expect(isAgentRole(role)).toBe(true)
    }
  })

  it('rejects an unknown role', () => {
    expect(isAgentRole('dungeon_master_supreme')).toBe(false)
  })
})

describe('AGENT_ROLE_LABELS', () => {
  it('has a label for every role with a system default', () => {
    for (const role of Object.keys(SYSTEM_DEFAULT_MODEL_MAP)) {
      expect(AGENT_ROLE_LABELS[role as keyof typeof AGENT_ROLE_LABELS]).toBeTruthy()
    }
  })
})

describe('two seats instead of fourteen rows', () => {
  it('derives each role tier from its own system default', () => {
    // Derived, not a second list - so moving a role between tiers in SYSTEM_DEFAULT_MODEL_MAP
    // moves it in the settings UI too, with nothing to keep in sync.
    expect(tierOfRole('narrator')).toBe('primary')
    expect(tierOfRole('story_director')).toBe('primary')
    expect(tierOfRole('adjudicator')).toBe('secondary')
    expect(tierOfRole('summarizer')).toBe('secondary')
    // Primary since 570ca7f: this role runs the stage-6 group classifier, which deletes npc rows.
    expect(tierOfRole('consistency_checker')).toBe('primary')
    expect(ROLES_BY_TIER.primary.length + ROLES_BY_TIER.secondary.length)
      .toBe(Object.keys(SYSTEM_DEFAULT_MODEL_MAP).length)
  })

  it('expands two choices into a full per-role map', () => {
    // Expanding here is what keeps resolveModel and every stored map working untouched.
    const map = expandTiers('model-A', 'model-B')
    expect(map.narrator).toBe('model-A')
    expect(map.adjudicator).toBe('model-B')
    expect(Object.keys(map)).toHaveLength(Object.keys(SYSTEM_DEFAULT_MODEL_MAP).length)
  })

  it('round-trips, and reports defaults for an empty map', () => {
    expect(tiersFromMap({})).toEqual({ primary: PRIMARY_MODEL, secondary: SECONDARY_MODEL, custom: false })
    const { primary, secondary, custom } = tiersFromMap(expandTiers('model-A', 'model-B'))
    expect({ primary, secondary, custom }).toEqual({ primary: 'model-A', secondary: 'model-B', custom: false })
  })

  it('FLAGS a per-role map it cannot represent rather than flattening it silently', () => {
    // From the old fourteen-row UI: one primary role moved to the cheap model. Two selects cannot
    // express that, and the user cannot recover it once overwritten - so the UI must warn first.
    const uneven = { ...expandTiers(PRIMARY_MODEL, SECONDARY_MODEL), narrator: SECONDARY_MODEL }
    expect(tiersFromMap(uneven).custom).toBe(true)
  })
})
