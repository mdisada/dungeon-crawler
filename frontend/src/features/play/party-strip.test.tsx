// The party bar during live play. Portraits are read client-side (party RLS on both the characters
// table and the characters bucket), so this asserts the render contract, not the fetch.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

const fetchPartyPortraits = vi.fn()
vi.mock('./api/party-portraits', () => ({
  fetchPartyPortraits: (ids: string[]) => fetchPartyPortraits(ids) as Promise<unknown>,
}))

const { PartyStrip } = await import('./components/party-strip')
type PlayerView = import('@rules/state').PlayerView

function player(over: Partial<PlayerView> = {}): PlayerView {
  return {
    userId: 'u1',
    characterId: 'c1',
    name: 'Ash',
    connected: true,
    hp: { current: 10, max: 10, temp: 0 },
    conditions: [],
    ...over,
  }
}

describe('the party bar', () => {
  it('falls back to an initial while the portraits are still resolving', () => {
    fetchPartyPortraits.mockReturnValue(new Promise(() => {}))
    render(<PartyStrip players={[player(), player({ characterId: 'c2', name: 'Bryn' })]} />)

    expect(screen.getByText('Ash')).toBeInTheDocument()
    expect(screen.getByText('Bryn')).toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('draws each character token once its signed URL lands', async () => {
    fetchPartyPortraits.mockResolvedValue({
      c1: { portrait: 'signed://ash-portrait', token: 'signed://ash-token' },
    })
    render(<PartyStrip players={[player()]} />)

    // Decorative: the name beside it is what a screen reader reads, so alt is empty by design.
    const token = await screen.findByAltText('')
    expect(token).toHaveAttribute('src', 'signed://ash-token')
  })

  it('reads out hit points a sighted player gets from the bar', () => {
    fetchPartyPortraits.mockReturnValue(new Promise(() => {}))
    render(<PartyStrip players={[player({ hp: { current: 3, max: 12, temp: 0 } })]} />)
    expect(screen.getByText('3 of 12 hit points')).toBeInTheDocument()
  })
})
