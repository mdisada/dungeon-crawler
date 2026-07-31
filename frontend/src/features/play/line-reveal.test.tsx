// What the scene box is allowed to deliver. Every say route stages the player's own words as a
// dialogue line and points activeLineId at them, so without the provider's narrated-line rule the
// box would echo the player back at themselves before the DM's reply lands.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { initialGameState } from '@rules/state'
import type { DialogueLine, GameState } from '@rules/state'

import { NarrationView } from './components/narration-view'
import { PlayProvider } from './components/play-context'
import type { MemberAdventure } from './types'

const adventure: MemberAdventure = {
  id: 'adv-1', title: 'Test', status: 'active', mode: 'full_ai', type: 'one_shot',
  minPlayers: 1, maxPlayers: 2, inviteCode: 'code', creatorId: 'user-ash',
  isDemo: true, createdAt: new Date().toISOString(),
}

// Two sentences that cannot share a chunk, so the reveal has somewhere to be interrupted.
const FIRST = 'The gate groans open on a hall of broken statues, and the dust of a century turns slowly in the lamplight above the shattered floor.'
const SECOND = 'Somewhere below, water is moving against the current in a way no honest river has ever managed on its own account.'

const narration: DialogueLine = { id: 'l1', speaker: null, npcId: null, text: `${FIRST} ${SECOND}` }
const partyLine: DialogueLine = { id: 'l2', speaker: 'Ash', npcId: null, text: 'I step through the gate.' }
const reply: DialogueLine = { id: 'l3', speaker: null, npcId: null, text: 'The statues do not turn to watch you.' }

function stateWith(lines: DialogueLine[], activeLineId: string | null): GameState {
  const state = initialGameState()
  state.session = { id: 's1', index: 1, status: 'active', recap: null }
  state.players.list = [
    { userId: 'user-ash', characterId: 'pc-ash', name: 'Ash', connected: true, hp: { current: 10, max: 10, temp: 0 }, conditions: [] },
  ]
  state.dialogue.lines = lines
  state.dialogue.activeLineId = activeLineId
  return state
}

function scene(state: GameState) {
  return (
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
      <NarrationView scene={state.scene} />
    </PlayProvider>
  )
}

describe('the scene box', () => {
  it('reveals one chunk at a time, the rest behind the advance control', async () => {
    const user = userEvent.setup()
    render(scene(stateWith([narration], 'l1')))
    expect(screen.getByText(new RegExp(FIRST))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(SECOND))).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more of this line' }))
    expect(screen.getByText(new RegExp(SECOND))).toBeInTheDocument()
  })

  it('never gives the box to the party, and keeps the reader where they were', async () => {
    const user = userEvent.setup()
    const { rerender } = render(scene(stateWith([narration], 'l1')))
    await user.click(screen.getByRole('button', { name: 'Show more of this line' }))

    // The player sends: the server stages their line and makes it active.
    rerender(scene(stateWith([narration, partyLine], 'l2')))
    expect(screen.queryByText(/I step through the gate/)).not.toBeInTheDocument()
    // Still on the sentence they had advanced to - not rewound to the top of the line.
    expect(screen.getByText(new RegExp(SECOND))).toBeInTheDocument()

    // The DM's reply lands and takes the box.
    rerender(scene(stateWith([narration, partyLine, reply], 'l3')))
    expect(screen.getByText(/The statues do not turn to watch you/)).toBeInTheDocument()
  })

  it('empties when the server clears the active line', () => {
    render(scene(stateWith([narration, partyLine], null)))
    expect(screen.queryByText(new RegExp(FIRST))).not.toBeInTheDocument()
    expect(screen.queryByText(/I step through the gate/)).not.toBeInTheDocument()
  })
})
