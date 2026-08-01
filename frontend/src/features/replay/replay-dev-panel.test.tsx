// The dev panel is the only thing the replay sandbox adds to the play screen, and the thing it
// must never do is offer a command the server will refuse - a fight cannot start without an open
// session, and a second one cannot start on top of a live one.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReplayBattle, ReplayStatus } from './types'

const status = vi.hoisted(() => ({ current: null as ReplayStatus | null }))
const battles = vi.hoisted(() => ({ current: [] as ReplayBattle[] }))
const startCombat = vi.hoisted(() => vi.fn())
const restart = vi.hoisted(() => vi.fn())

vi.mock('./api/replay', () => ({
  fetchReplayStatus: () => Promise.resolve(status.current),
  listReplayBattles: () => Promise.resolve(battles.current),
  startReplayCombat: startCombat,
  restartAdventure: restart,
  enterReplay: vi.fn(),
  exitReplay: vi.fn(),
  startReplaySession: vi.fn(),
  endReplaySession: vi.fn(),
}))

import { ReplayDevPanel } from './components/replay-dev-panel'

const IDLE: ReplayStatus = {
  sessionStatus: 'lobby',
  sceneMode: 'narration',
  encounterLabel: null,
  combatActive: false,
  round: null,
  version: 12,
}

const BATTLE: ReplayBattle = {
  objectiveId: 'obj-1',
  objectiveTitle: 'Break the siege',
  encounterId: 'enc-1',
  label: 'Ambush at the gate',
  hasMap: true,
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <ReplayDevPanel adventureId="adv-1" adventureStatus="completed" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  status.current = IDLE
  battles.current = [BATTLE]
  startCombat.mockReset()
  restart.mockReset()
  restart.mockResolvedValue({ baseline: 'activate', rows_restored: 42 })
})

afterEach(cleanup)

describe('ReplayDevPanel', () => {
  it('reads back the live session, scene, encounter, and combat state', async () => {
    status.current = {
      ...IDLE,
      sessionStatus: 'active',
      sceneMode: 'battle',
      encounterLabel: 'Ambush at the gate',
      combatActive: true,
      round: 3,
    }
    renderPanel()
    await waitFor(() => expect(screen.getByText('active')).toBeTruthy())
    expect(screen.getByText('battle')).toBeTruthy()
    expect(screen.getByText('Ambush at the gate', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('round 3')).toBeTruthy()
  })

  it('shows the idle readout when nothing is running', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByText('lobby')).toBeTruthy())
    expect(screen.getByText('narration')).toBeTruthy()
    expect(screen.getAllByText('none')).toHaveLength(2)
  })

  it('refuses to start a fight while the session is not running', async () => {
    renderPanel()
    const button = await screen.findByRole('button', { name: 'Start fight' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toBe('Start the session first')
  })

  it('refuses to start a second fight on top of a live one', async () => {
    status.current = { ...IDLE, sessionStatus: 'active', combatActive: true, round: 2 }
    renderPanel()
    const button = await screen.findByRole('button', { name: 'Start fight' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toBe('A fight is already on the table')
  })

  it('says so when the adventure authored no battles', async () => {
    battles.current = []
    renderPanel()
    expect(await screen.findByText('This adventure authored no battles.')).toBeTruthy()
  })

  it('will not wipe a playthrough on one click', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Restart from guide' }))
    expect(restart).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Wipe and restore' }))
    expect(restart).toHaveBeenCalledWith('adv-1')
  })

  it('flags a reconstructed baseline as approximate', async () => {
    restart.mockResolvedValue({ baseline: 'backfill', rows_restored: 30 })
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Restart from guide' }))
    await user.click(screen.getByRole('button', { name: 'Wipe and restore' }))
    expect(await screen.findByText(/reconstructed baseline — approximate/)).toBeTruthy()
  })

  it('offers Start session in the lobby and End session once live', async () => {
    const { unmount } = renderPanel()
    expect(await screen.findByRole('button', { name: 'Start session' })).toBeTruthy()
    unmount()

    status.current = { ...IDLE, sessionStatus: 'active' }
    renderPanel()
    expect(await screen.findByRole('button', { name: 'End session' })).toBeTruthy()
  })
})
