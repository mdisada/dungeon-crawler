import { describe, expect, it } from 'vitest'

import { initialGameState } from '../state/index.ts'
import { checkGateActive, dialogueGateActive, DEFAULT_DM_SETTINGS, dmSettings, parseGists } from './review.ts'

describe('dialogueGateActive', () => {
  it('gates assist mode with auto-dialogue off', () => {
    expect(dialogueGateActive({ mode: 'assist', autoDialogue: false })).toBe(true)
  })
  it('does not gate assist mode with auto-dialogue on', () => {
    expect(dialogueGateActive({ mode: 'assist', autoDialogue: true })).toBe(false)
  })
  it('never gates full-AI or unknown modes', () => {
    expect(dialogueGateActive({ mode: 'full_ai', autoDialogue: false })).toBe(false)
    expect(dialogueGateActive({ mode: null, autoDialogue: false })).toBe(false)
  })
})

describe('checkGateActive', () => {
  it('gates assist mode with auto-checks off', () => {
    expect(checkGateActive({ mode: 'assist', autoChecks: false })).toBe(true)
  })
  it('does not gate assist with auto-checks on, full-AI, or unknown modes', () => {
    expect(checkGateActive({ mode: 'assist', autoChecks: true })).toBe(false)
    expect(checkGateActive({ mode: 'full_ai', autoChecks: false })).toBe(false)
    expect(checkGateActive({ mode: null, autoChecks: false })).toBe(false)
  })
})

describe('dmSettings', () => {
  it('reads settings from state', () => {
    const state = initialGameState()
    state.dm!.settings = { autoDialogue: true, autoChecks: false }
    expect(dmSettings(state).autoDialogue).toBe(true)
  })
  it('defaults to full DM control when settings are absent (pre-Slice-2 states)', () => {
    const state = initialGameState()
    delete state.dm!.settings
    expect(dmSettings(state)).toEqual(DEFAULT_DM_SETTINGS)
    expect(dmSettings(state).autoDialogue).toBe(false)
  })
  it('defaults when the dm domain is stripped (player state)', () => {
    const state = { ...initialGameState(), dm: null }
    expect(dmSettings(state)).toEqual(DEFAULT_DM_SETTINGS)
  })
})

describe('parseGists', () => {
  it('accepts exactly three trimmed gists', () => {
    expect(parseGists({ gists: [' Refuses, hints at the cellar ', 'Warms up', 'Deflects with a joke'] })).toEqual([
      'Refuses, hints at the cellar',
      'Warms up',
      'Deflects with a joke',
    ])
  })
  it('drops extras beyond three', () => {
    expect(parseGists({ gists: ['a', 'b', 'c', 'd'] })).toHaveLength(3)
  })
  it('rejects too few usable gists', () => {
    expect(() => parseGists({ gists: ['only one', '', '   '] })).toThrow(/expected 3/)
    expect(() => parseGists({ gists: ['a', 'b', 42] })).toThrow(/expected 3/)
  })
  it('rejects malformed shapes', () => {
    expect(() => parseGists(null)).toThrow()
    expect(() => parseGists({})).toThrow(/gists missing/)
    expect(() => parseGists({ gists: 'nope' })).toThrow(/gists missing/)
  })
})
