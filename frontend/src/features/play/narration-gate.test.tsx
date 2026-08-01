import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initialGameState } from '@rules/state'
import type { DialogueLine, GameState } from '@rules/state'

import { NarrationView } from './components/narration-view'
import { PlayProvider } from './components/play-context'
import type { MemberAdventure } from './types'

// The gate is what this file is about, so the audio layer is a dial rather than a network call.
// `settled` counts leading SYNTHESIS UNITS, which under the `lead` split is not the same as boxes:
// LONG below becomes boxes [3 sentences][1 sentence], so units [0,1,2] and [3].
const audio = {
  canReveal: true,
  settled: 99,
  play: vi.fn(),
  playSequence: vi.fn(),
  stop: vi.fn(),
  needsUnlock: false,
  unlock: vi.fn(),
  state: { lineId: null, phase: 'active' as const, chunks: [], serverTimings: null, error: null },
  // Unused by useNarration since it gates on boxes, kept to satisfy the hook's contract.
  canAdvance: (): boolean => true,
}

vi.mock('@/features/tts', () => ({ useNarrationAudio: () => audio }))

const adventure = {
  id: 'adv-1',
  title: 'The Drowned Lock',
  status: 'active',
  mode: 'full_ai',
  role: 'player',
} as unknown as MemberAdventure

// Longer than REVEAL_MAX_CHARS (240), so chunkSentences splits it and there is a second box to
// advance to - without that there is no chevron to withhold and the test proves nothing.
const LONG =
  'The stair ends in water. Not a flood - a still, black sheet that fills the chamber floor to ' +
  'floor, so flat it takes a moment to see it at all. Your torchlight goes into it and does not ' +
  'come back. Somewhere ahead, past the reach of the flame, something displaces enough of it to ' +
  'send one slow ring travelling out toward your boots.'

function stateWith(lines: DialogueLine[], activeLineId: string): GameState {
  const state = initialGameState()
  state.session = { id: 's1', index: 1, status: 'active', recap: null }
  state.players.list = [
    {
      userId: 'user-ash',
      characterId: 'pc-ash',
      name: 'Ash',
      connected: true,
      hp: { current: 10, max: 10, temp: 0 },
      conditions: [],
    },
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
      narrationVolume={0.9}
      isMuted={false}
    >
      <NarrationView scene={state.scene} dialogue={state.dialogue} players={state.players} />
    </PlayProvider>
  )
}

const first: DialogueLine = { id: 'line-1', speaker: null, npcId: null, text: 'The lock is shut.' }
const second: DialogueLine = { id: 'line-2', speaker: null, npcId: null, text: LONG }

beforeEach(() => {
  audio.canReveal = true
  audio.settled = 99
  audio.playSequence.mockClear()
})

// Explicit because the project's vitest config does not set `globals`, so Testing Library's
// automatic cleanup never registers and rendered DOM otherwise survives into the next test - a
// stale chevron from the test above is exactly the thing these assertions look for.
afterEach(cleanup)

describe('holding a new line for its first clip', () => {
  it('keeps the previous beat on screen until the incoming line has audio', () => {
    audio.canReveal = false
    const { rerender } = render(scene(stateWith([first], 'line-1')))

    // The very first line of a session has nothing to hold behind it, so the box stays empty
    // rather than showing a line whose voice has not arrived.
    expect(screen.queryByText(first.text)).not.toBeInTheDocument()

    audio.canReveal = true
    rerender(scene(stateWith([first], 'line-1')))
    expect(screen.getByText(first.text)).toBeInTheDocument()

    // A second line lands while its audio is still being made: the first must stay put.
    audio.canReveal = false
    rerender(scene(stateWith([first, second], 'line-2')))
    expect(screen.getByText(first.text)).toBeInTheDocument()

    audio.canReveal = true
    rerender(scene(stateWith([first, second], 'line-2')))
    expect(screen.queryByText(first.text)).not.toBeInTheDocument()
  })

  it('swaps immediately when the server clears the active line, audio or not', () => {
    audio.canReveal = true
    const { rerender } = render(scene(stateWith([first], 'line-1')))
    expect(screen.getByText(first.text)).toBeInTheDocument()

    // Staging a social scene or ending a session clears activeLineId deliberately - a stale line
    // must not linger behind an audio gate that will never open for it.
    audio.canReveal = false
    const cleared = stateWith([first], 'line-1')
    cleared.dialogue.activeLineId = null
    rerender(scene(cleared))
    expect(screen.queryByText(first.text)).not.toBeInTheDocument()
  })
})

describe('the advance chevron', () => {
  it('is withheld until every clip of the NEXT box has settled', () => {
    // Box 0's three sentences are done, so it is on screen - but box 1's clip is not, so there is
    // nothing to advance to yet. Gating on units rather than boxes would wrongly offer it here.
    audio.settled = 3
    const { rerender } = render(scene(stateWith([second], 'line-2')))
    expect(screen.queryByRole('button', { name: /show more of this line/i })).not.toBeInTheDocument()

    audio.settled = 4
    rerender(scene(stateWith([second], 'line-2')))
    expect(screen.getByRole('button', { name: /show more of this line/i })).toBeInTheDocument()
  })

  it('plays every clip the visible box is made of, in order', () => {
    render(scene(stateWith([second], 'line-2')))
    // Box 0 of the long line is three sentences under the `lead` split, queued back to back.
    expect(audio.playSequence).toHaveBeenCalledWith([0, 1, 2])
  })
})
