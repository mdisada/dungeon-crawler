import { describe, expect, it } from 'vitest'

import {
  AGENT_ROLE_LABELS,
  isAgentRole,
  resolveModel,
  SYSTEM_DEFAULT_MODEL_MAP,
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
