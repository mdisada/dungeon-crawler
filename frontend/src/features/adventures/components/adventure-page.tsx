import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { getAdventure } from '../api/get-adventure'
import type { Adventure } from '../types'

type AdventureState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; adventure: Adventure }

// Minimal landing page for /adventures/:id. Once generation has started, the F4 guide editor
// (/adventures/:id/guide) owns everything - this page only still renders for plain drafts.
export function AdventurePage() {
  const { id } = useParams<{ id: string }>()
  const [state, setState] = useState<AdventureState>({ status: 'loading' })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getAdventure(id)
      .then((adventure) => {
        if (!cancelled) setState({ status: 'ready', adventure })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load adventure' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (state.status === 'loading') return <p className="p-8 text-muted-foreground">Loading…</p>
  if (state.status === 'error') return <p className="p-8 text-destructive">{state.message}</p>

  const { adventure } = state
  if (adventure.status === 'active' || adventure.status === 'completed') {
    return <Navigate to={`/adventures/${adventure.id}/play`} replace />
  }
  if (adventure.status !== 'draft') return <Navigate to={`/adventures/${adventure.id}/guide`} replace />

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <h1>Adventure</h1>
      <p className="text-muted-foreground">Status: {adventure.status}</p>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Mode:</dt>
          <dd>{adventure.mode === 'full_ai' ? 'Full-AI DM' : adventure.mode === 'assist' ? 'AI-Assist' : '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Players:</dt>
          <dd>
            {adventure.minPlayers}–{adventure.maxPlayers}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Type:</dt>
          <dd>
            {adventure.type === 'one_shot'
              ? 'One-shot'
              : adventure.type === 'multi_chapter'
                ? `Multi-chapter (${adventure.chaptersMin}–${adventure.chaptersMax} chapters)`
                : '—'}
          </dd>
        </div>
        {adventure.difficultyPreset && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Difficulty:</dt>
            <dd className="capitalize">{adventure.difficultyPreset}</dd>
          </div>
        )}
      </dl>
      {adventure.plotIdea && <p className="max-w-prose text-sm leading-relaxed">{adventure.plotIdea}</p>}
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Back to home
      </Link>
    </div>
  )
}
