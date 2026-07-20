// Phase 5 UI: the intent input row and the pending-check prompt, rendered against handcrafted
// GameState snapshots inside a real PlayProvider (behavior-level, per testing rules).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { initialGameState } from '@rules/state'
import type { GameState, PendingPromptState } from '@rules/state'

import { CheckPrompt } from './components/check-prompt'
import { IntentInputRow } from './components/intent-input-row'
import { PlayProvider } from './components/play-context'
import type { MemberAdventure } from './types'

const adventure: MemberAdventure = {
  id: 'adv-1', title: 'Test', status: 'active', mode: 'full_ai', type: 'one_shot',
  minPlayers: 1, maxPlayers: 2, inviteCode: 'code', creatorId: 'user-ash',
  isDemo: true, createdAt: new Date().toISOString(),
}

function stateWith(overrides: (state: GameState) => void): GameState {
  const state = initialGameState()
  state.session = { id: 's1', index: 1, status: 'active', recap: null }
  state.players.list = [
    { userId: 'user-ash', characterId: 'pc-ash', name: 'Ash', connected: true, hp: { current: 10, max: 10, temp: 0 }, conditions: [] },
    { userId: 'user-bryn', characterId: 'pc-bryn', name: 'Bryn', connected: true, hp: { current: 8, max: 8, temp: 0 }, conditions: [] },
  ]
  overrides(state)
  return state
}

function renderAsAsh(state: GameState, ui: React.ReactNode) {
  return render(
    <PlayProvider
      adventure={adventure}
      userId="user-ash"
      state={state}
      version={1}
      role="player"
      isSpectator={false}
      connection="live"
      fx={[]}
    >
      {ui}
    </PlayProvider>,
  )
}

const future = new Date(Date.now() + 60_000).toISOString()

describe('IntentInputRow', () => {
  it('offers a single Send line to the DM - no unprompted roll controls', () => {
    renderAsAsh(stateWith(() => {}), <IntentInputRow />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Say' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Do' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Roll' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Action or dialogue input')).toBeEnabled()
  })

  it('locks the input and shows the thinking indicator while the DM works', () => {
    renderAsAsh(stateWith((s) => { s.dialogue.typing = true }), <IntentInputRow />)
    expect(screen.getByLabelText('Action or dialogue input')).toBeDisabled()
    expect(screen.getByText(/DM is thinking/)).toBeInTheDocument()
  })

  it('shows opening chips only for PCs other than the unlocker', () => {
    const opening = { id: 'op1', unlockedBy: 'pc-bryn', npcId: 'npc-1', skill: 'persuasion', dcMod: -2, hint: 'he hides grief - Persuasion eased' }
    renderAsAsh(stateWith((s) => { s.dialogue.openings = [opening] }), <IntentInputRow />)
    expect(screen.getByText(/Persuasion eased/)).toBeInTheDocument()
    cleanup()
    const own = { ...opening, id: 'op2', unlockedBy: 'pc-ash', hint: 'your own discovery' }
    renderAsAsh(stateWith((s) => { s.dialogue.openings = [own] }), <IntentInputRow />)
    expect(screen.queryByText(/your own discovery/)).not.toBeInTheDocument()
  })
})

describe('CheckPrompt', () => {
  it('offers the actor a Roll button on their solo check', () => {
    const pending: PendingPromptState = {
      kind: 'check', id: 'p1', skill: 'athletics', reason: 'wet planks',
      deadline: future, actorCharacterId: 'pc-ash', advDis: 'none',
    }
    renderAsAsh(stateWith((s) => { s.dialogue.pending = pending }), <CheckPrompt />)
    expect(screen.getByRole('button', { name: 'Roll' })).toBeInTheDocument()
    expect(screen.getByText(/athletics/)).toBeInTheDocument()
  })

  it('offers one roll button per DM-called skill option', () => {
    const pending: PendingPromptState = {
      kind: 'check', id: 'p1', skill: 'intelligence', skillOptions: ['intelligence', 'investigation'],
      reason: 'are the gargoyles creatures?', deadline: future, actorCharacterId: 'pc-ash', advDis: 'none',
    }
    renderAsAsh(stateWith((s) => { s.dialogue.pending = pending }), <CheckPrompt />)
    expect(screen.getByRole('button', { name: 'Roll intelligence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Roll investigation' })).toBeInTheDocument()
    expect(screen.getByText(/The DM calls for a check/)).toBeInTheDocument()
  })

  it('shows waiting copy when the check belongs to someone else', () => {
    const pending: PendingPromptState = {
      kind: 'check', id: 'p1', skill: 'insight', reason: 'reading the elder',
      deadline: future, actorCharacterId: 'pc-bryn', advDis: 'none',
    }
    renderAsAsh(stateWith((s) => { s.dialogue.pending = pending }), <CheckPrompt />)
    expect(screen.queryByRole('button', { name: 'Roll' })).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for Bryn/)).toBeInTheDocument()
  })

  it('renders group progress and a roll button for members who have not rolled', () => {
    const pending: PendingPromptState = {
      kind: 'group', id: 'g1', skill: 'stealth', reason: 'sneaking together',
      deadline: future, memberCharacterIds: ['pc-ash', 'pc-bryn'],
      rolled: [{ characterId: 'pc-bryn', total: 14, success: true }],
    }
    renderAsAsh(stateWith((s) => { s.dialogue.pending = pending }), <CheckPrompt />)
    expect(screen.getByText('Bryn: 14')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Roll' })).toBeInTheDocument()
  })

  it('offers Help on an assist slot to everyone but the primary', () => {
    const pending: PendingPromptState = {
      kind: 'assist', id: 'a1', skill: 'athletics', reason: 'the gate is heavy',
      deadline: future, primaryCharacterId: 'pc-bryn', primarySkill: 'athletics', effect: 'enable',
    }
    renderAsAsh(stateWith((s) => { s.dialogue.pending = pending }), <CheckPrompt />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
    expect(screen.getByText(/hinges on it/)).toBeInTheDocument()
  })
})
