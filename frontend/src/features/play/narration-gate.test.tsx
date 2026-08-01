import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// Synthesis for the line the player has not reached yet, started while they read this one.
// Hoisted with the vi.mock factory, which is lifted above every other statement in this file.
const { requestNarration, warmNarrationVoice } = vi.hoisted(() => ({
  requestNarration: vi.fn(() => Promise.resolve({ silent: true, chunks: [] })),
  warmNarrationVoice: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/features/tts', () => ({ useNarrationAudio: () => audio, requestNarration, warmNarrationVoice }))

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

function stateWith(lines: DialogueLine[], activeLineId: string | null): GameState {
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

function scene(state: GameState, isMuted = false) {
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
      narrationVolume={isMuted ? 0 : 0.9}
      isMuted={isMuted}
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
  requestNarration.mockClear()
  warmNarrationVoice.mockClear()
})

// Explicit because the project's vitest config does not set `globals`, so Testing Library's
// automatic cleanup never registers and rendered DOM otherwise survives into the next test - a
// stale chevron from the test above is exactly the thing these assertions look for.
afterEach(cleanup)

describe('holding a new line for its first clip', () => {
  it('keeps the previous beat on screen until the incoming line has audio', async () => {
    const user = userEvent.setup()
    audio.canReveal = false
    const { rerender } = render(scene(stateWith([first], 'line-1')))

    // The very first line of a session has nothing to hold behind it, so the box stays empty
    // rather than showing a line whose voice has not arrived.
    expect(screen.queryByText(first.text)).not.toBeInTheDocument()

    audio.canReveal = true
    rerender(scene(stateWith([first], 'line-1')))
    expect(screen.getByText(first.text)).toBeInTheDocument()

    // A second line lands. It queues behind the first, which the player has not clicked past.
    rerender(scene(stateWith([first, second], 'line-2')))
    expect(screen.getByText(first.text)).toBeInTheDocument()

    // They click on, and the second line is held until its first clip is playable.
    audio.canReveal = false
    await user.click(screen.getByRole('button', { name: /show more of this line/i }))
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

describe('synthesis for the line queued behind the one being read', () => {
  it('is requested while the player is still on the current line', () => {
    const { rerender } = render(scene(stateWith([first], 'line-1')))
    expect(requestNarration).not.toHaveBeenCalled()

    // line-2 lands and queues. It is asked for NOW, so its first clip is not a fresh wait when the
    // player clicks on. The chunks are the `lead` split - exactly what the real request sends.
    rerender(scene(stateWith([first, second], 'line-2')))
    expect(requestNarration).toHaveBeenCalledTimes(1)
    expect(requestNarration).toHaveBeenCalledWith(
      expect.objectContaining({ lineId: 'line-2', chunks: expect.arrayContaining([expect.any(String)]) }),
    )

    // Once per line, however many state broadcasts arrive behind it.
    rerender(scene(stateWith([first, second], 'line-2')))
    expect(requestNarration).toHaveBeenCalledTimes(1)
  })

  it('is not requested at all when the player has muted narration', () => {
    const { rerender } = render(scene(stateWith([first], 'line-1'), true))
    rerender(scene(stateWith([first, second], 'line-2'), true))
    expect(requestNarration).not.toHaveBeenCalled()
    expect(warmNarrationVoice).not.toHaveBeenCalled()
  })

  it('registers the narrator voice with Fish before there is a line to speak', () => {
    // Nothing has been staged yet - the table is still in the lobby - and the ~9s first-use
    // registration is already under way rather than sitting in front of the session's first line.
    render(scene(stateWith([], null)))
    expect(warmNarrationVoice).toHaveBeenCalledWith('adv-1')
  })
})
