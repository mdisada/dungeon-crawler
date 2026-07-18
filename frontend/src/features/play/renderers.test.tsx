// State-diff renderer tests (DEVELOPMENT-PLAN PHASE 4): drive GameStates through the same
// scripted diff sequences the demo driver uses and assert each renderer draws the right thing
// from state alone - no client-side inference (F06 SS7 acceptance criterion).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

// Vitest globals are off in this project, so RTL's automatic cleanup never registers.
afterEach(cleanup)

import { applyDiffs, buildDemoScript, initialGameState } from '@rules/state'
import type { DemoContext, GameState } from '@rules/state'

import { BattleMap } from './components/battle-map'
import { DowntimeView } from './components/downtime-view'
import { NarrationView } from './components/narration-view'
import { RoleplayView } from './components/roleplay-view'
import { PlayProvider } from './components/play-context'
import type { MemberAdventure } from './types'

const ctx: DemoContext = {
  locationId: 'loc-1',
  locationName: 'Hollowbrook',
  backgroundUrl: 'https://example.test/bg.png',
  mapUrl: null,
  obstacles: [[3, 3]],
  npcs: [
    { id: 'n1', name: 'Elder Maren', imageUrl: null },
    { id: 'n2', name: 'The Stranger', imageUrl: null },
  ],
  objectives: [
    { id: 'o1', title: 'Find the missing boy' },
    { id: 'o2', title: 'Learn what the stranger wants' },
  ],
  party: [
    { userId: 'u1', characterId: 'c1', name: 'Ash', imageUrl: null },
    { userId: 'u2', characterId: 'c2', name: 'Bryn', imageUrl: null },
  ],
}

const adventure: MemberAdventure = {
  id: 'adv-1', title: 'Demo', status: 'active', mode: 'assist', type: 'one_shot',
  minPlayers: 1, maxPlayers: 4, inviteCode: 'code', creatorId: 'dm-user', isDemo: true,
  createdAt: new Date().toISOString(),
}

/** Walks the scripted demo diffs and returns every intermediate state. */
function walk(): GameState[] {
  const states: GameState[] = []
  let state = initialGameState()
  for (const step of buildDemoScript(ctx)) {
    state = applyDiffs(state, step.diffs)
    states.push(state)
  }
  return states
}

function renderBattle(state: GameState, userId = 'u1', role: 'dm' | 'player' = 'player') {
  return render(
    <PlayProvider
      adventure={adventure}
      userId={userId}
      state={state}
      version={1}
      role={role}
      isSpectator={false}
      connection="live"
      fx={[]}
    >
      <BattleMap combat={state.combat!} />
    </PlayProvider>,
  )
}

describe('renderers from scripted diff sequences', () => {
  const states = walk()

  it('narration state renders the background and the narrated line', () => {
    const narration = states[0]
    render(<NarrationView scene={narration.scene} dialogue={narration.dialogue} />)
    expect(screen.getByAltText('Hollowbrook')).toBeInTheDocument()
    expect(screen.getByText(/Dusk settles/)).toBeInTheDocument()
  })

  it('roleplay state renders speaker name plates and the active line', () => {
    const roleplay = states.find((s) => s.scene.mode === 'roleplay')!
    render(
      <RoleplayView scene={roleplay.scene} dialogue={roleplay.dialogue} players={roleplay.players} isSpectator={false} />,
    )
    // Name appears on the plate and in the portrait's sr-only caption.
    expect(screen.getAllByText('Elder Maren').length).toBeGreaterThan(0)
    expect(screen.getByText(/Thank the stars/)).toBeInTheDocument()
  })

  it('battle state renders tokens, initiative ribbon, and the turn banner', () => {
    const battle = states.find((s) => s.scene.mode === 'battle')!
    renderBattle(battle)
    expect(screen.getByLabelText('Initiative order')).toBeInTheDocument()
    expect(screen.getByText(/turn$/i)).toBeInTheDocument()
    // Both PCs and at least one enemy landed as tokens.
    expect(screen.getByRole('button', { name: /Ash at column/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bryn at column/ })).toBeInTheDocument()
  })

  it('only the active token owner can drag their token (controller gating)', () => {
    const battle = states.find((s) => s.scene.mode === 'battle')!
    const active = battle.combat!.tokens.find((t) => t.id === battle.combat!.activeTokenId)!
    renderBattle(battle, active.controllerUserId ?? 'u1')
    const own = screen.getByRole('button', { name: new RegExp(`${active.name} at column`) })
    expect(own).toBeEnabled()
    const other = battle.combat!.tokens.find((t) => t.kind === 'pc' && t.id !== active.id)!
    expect(screen.getByRole('button', { name: new RegExp(`${other.name} at column`) })).toBeDisabled()
  })

  it('the DM can drag any token', () => {
    const battle = states.find((s) => s.scene.mode === 'battle')!
    renderBattle(battle, 'dm-user', 'dm')
    for (const token of battle.combat!.tokens) {
      expect(screen.getByRole('button', { name: new RegExp(`${token.name} at column`) })).toBeEnabled()
    }
  })

  it('battle end state clears combat and downtime renders the log view', () => {
    const last = states.at(-1)!
    expect(last.combat).toBeNull()
    render(<DowntimeView dialogue={last.dialogue} />)
    expect(screen.getByText('Downtime')).toBeInTheDocument()
    expect(screen.getByText(/Sleeping Griffin/)).toBeInTheDocument()
  })
})
