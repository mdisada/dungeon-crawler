// Slice 1: the DM Main tab adapts to scene.mode - combat status in battle, the social
// encounter controls in roleplay, narration controls otherwise. Objectives + players pinned.
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

vi.mock('./api/lobby', () => ({
  listLobbyMembers: () => Promise.resolve([]),
}))
vi.mock('./api/story', () => ({
  fetchGuideNpcs: () => Promise.resolve([]),
  setNpcState: () => Promise.resolve(),
}))

import { initialGameState } from '@rules/state'
import type { CombatState, GameState } from '@rules/state'

import { DmMainTab } from './components/dm-tabs/main-tab'
import { DmOverviewPanel } from './components/dm-overview-panel'
import { PlayProvider } from './components/play-context'
import type { MemberAdventure } from './types'

const adventure: MemberAdventure = {
  id: 'adv-1', title: 'Test', status: 'active', mode: 'assist', type: 'one_shot',
  minPlayers: 1, maxPlayers: 2, inviteCode: 'code', creatorId: 'user-dm',
  isDemo: false, createdAt: new Date().toISOString(),
}

const emptyCombat: CombatState = {
  locationId: null, mapUrl: null, obstacles: [], tokens: [], initiative: [],
  round: 3, activeTokenId: '', economy: { action: true, bonus: true, move: 6, reaction: true },
}

function stateWith(overrides: (state: GameState) => void): GameState {
  const state = initialGameState()
  state.session = { id: 's1', index: 1, status: 'active', recap: null }
  state.dm!.objectives = [{ id: 'ob1', title: 'Find the relic', hidden: false, state: 'active' }]
  state.players.list = [
    { userId: 'user-ash', characterId: 'pc-ash', name: 'Ash', connected: true, hp: { current: 10, max: 10, temp: 0 }, conditions: [] },
  ]
  overrides(state)
  return state
}

function renderAsDm(state: GameState, node: ReactNode = <DmMainTab />) {
  return render(
    <PlayProvider
      adventure={adventure}
      userId="user-dm"
      state={state}
      version={1}
      role="dm"
      isSpectator={false}
      connection="live"
      fx={[]}
    >
      {node}
    </PlayProvider>,
  )
}

describe('DmMainTab', () => {
  it('renders the adaptive section without the objectives/players overview', () => {
    renderAsDm(stateWith((s) => { s.scene.mode = 'narration' }))
    expect(screen.queryByText('Find the relic')).not.toBeInTheDocument()
    expect(screen.queryByText('Ash')).not.toBeInTheDocument()
  })

  it('shows narration controls outside combat and roleplay', () => {
    renderAsDm(stateWith((s) => { s.scene.mode = 'narration' }))
    expect(screen.getByText('Narrate the next story')).toBeInTheDocument()
    expect(screen.getByLabelText('Narration direction')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /End encounter/ })).not.toBeInTheDocument()
  })

  it('shows the social encounter controls in roleplay mode', () => {
    renderAsDm(stateWith((s) => {
      s.scene.mode = 'roleplay'
      s.dialogue.speakers = [{ npcId: 'npc-1', name: 'Serana', side: 'left', imageUrl: null }]
    }))
    expect(screen.getByText('Serana')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /End encounter/ })).toBeInTheDocument()
    expect(screen.queryByText('Narrate the next story')).not.toBeInTheDocument()
  })

  it('shows combat status during battle', () => {
    renderAsDm(stateWith((s) => {
      s.scene.mode = 'battle'
      s.combat = emptyCombat
    }))
    expect(screen.getByText(/Round 3/)).toBeInTheDocument()
    expect(screen.queryByText('Narrate the next story')).not.toBeInTheDocument()
  })

  it('shows the auto-dialogue toggle for assist adventures, reflecting settings', () => {
    renderAsDm(stateWith((s) => { s.dm!.settings = { autoDialogue: true, autoChecks: false } }))
    const toggle = screen.getByRole('checkbox', { name: /Auto dialogue/ })
    expect(toggle).toBeChecked()
  })
})

describe('DmOverviewPanel', () => {
  it('renders objectives and players in collapsible sections', () => {
    renderAsDm(stateWith(() => {}), <DmOverviewPanel />)
    expect(screen.getByText('Find the relic')).toBeInTheDocument()
    expect(screen.getByText('Ash')).toBeInTheDocument()
  })
})

describe('ReviewConsole (via ReviewPanel in the Main tab)', () => {
  const review = {
    id: 'rev-1',
    kind: 'npc_reply' as const,
    npcId: 'npc-1',
    npcName: 'Serana',
    utterance: { actorCharacterId: 'pc-ash', actorName: 'Ash', text: 'Where is the relic?' },
    checkResult: { skill: 'persuasion', success: true, margin: 3 },
    candidates: [
      { id: 'c1', gist: 'Refuses, but hints at the cellar' },
      { id: 'c2', gist: 'Warms up and offers a deal' },
      { id: 'c3', gist: 'Deflects with a joke' },
    ],
    createdAt: new Date().toISOString(),
  }

  function roleplayState() {
    return stateWith((s) => {
      s.scene.mode = 'roleplay'
      s.dialogue.speakers = [{ npcId: 'npc-1', name: 'Serana', side: 'left', imageUrl: null }]
      s.dm!.pendingReview = review
    })
  }

  it('renders the candidates, check outcome, and all console actions', () => {
    renderAsDm(roleplayState())
    expect(screen.getByText(/Serana replies to Ash/)).toBeInTheDocument()
    expect(screen.getByText(/persuasion succeeded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refuses, but hints at the cellar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Warms up and offers a deal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deflects with a joke' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your own gist')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI answers this one/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('shows no console when nothing is pending', () => {
    renderAsDm(stateWith((s) => {
      s.scene.mode = 'roleplay'
      s.dialogue.speakers = [{ npcId: 'npc-1', name: 'Serana', side: 'left', imageUrl: null }]
    }))
    expect(screen.queryByText(/replies to/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /End encounter/ })).toBeInTheDocument()
  })

  it('shows a narration review outside roleplay mode', () => {
    renderAsDm(stateWith((s) => {
      s.scene.mode = 'narration'
      s.dm!.pendingReview = {
        id: 'rev-n',
        kind: 'narration',
        label: 'Story narration',
        prompt: 'Continue the story.',
        candidates: [
          { id: 'n1', gist: 'A storm rolls in' },
          { id: 'n2', gist: 'A stranger arrives' },
          { id: 'n3', gist: 'Distant bells toll' },
        ],
        createdAt: new Date().toISOString(),
      }
    }))
    expect(screen.getByText('Story narration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A storm rolls in' })).toBeInTheDocument()
    expect(screen.getByText('Narrate the next story')).toBeInTheDocument()
  })

  it('shows a check ruling with accept and flip actions', () => {
    renderAsDm(stateWith((s) => {
      s.scene.mode = 'roleplay'
      s.dialogue.speakers = [{ npcId: 'npc-1', name: 'Serana', side: 'left', imageUrl: null }]
      s.dm!.pendingReview = {
        id: 'rev-c',
        kind: 'check_ruling',
        actorName: 'Ash',
        skill: 'persuasion',
        total: 14,
        dc: 15,
        success: false,
        margin: -1,
        detail: '14 vs DC 15',
        createdAt: new Date().toISOString(),
      }
    }))
    expect(screen.getByText('Check ruling')).toBeInTheDocument()
    expect(screen.getByText(/14 vs DC 15/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept failure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rule success instead' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Your own gist')).not.toBeInTheDocument()
  })
})
