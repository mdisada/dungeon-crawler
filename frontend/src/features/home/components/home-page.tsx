import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { listMemberAdventures } from '@/features/play'
import type { MemberAdventure } from '@/features/play'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  generating: 'Generating…',
  guide_ready: 'Guide ready',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
}

function adventureLink(adventure: MemberAdventure): string {
  if (adventure.status === 'active' || adventure.status === 'completed') return `/adventures/${adventure.id}/play`
  return `/adventures/${adventure.id}`
}

export function HomePage() {
  const [adventures, setAdventures] = useState<MemberAdventure[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listMemberAdventures()
      .then((rows) => {
        if (!cancelled) setAdventures(rows)
      })
      .catch(() => {
        // The cards below still work without the list.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1>Welcome back</h1>
        <p className="text-lg text-muted-foreground">
          Pick up a campaign, start a new one, or manage your characters.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/adventures/new"
          className="flex flex-col gap-1 rounded-xl border bg-card p-5 transition-colors hover:border-ring hover:bg-accent"
        >
          <h2 className="text-base font-medium">New adventure</h2>
          <p className="text-sm text-muted-foreground">
            Set up an adventure and generate its guide with AI.
          </p>
        </Link>

        <Link
          to="/characters"
          className="flex flex-col gap-1 rounded-xl border bg-card p-5 transition-colors hover:border-ring hover:bg-accent"
        >
          <h2 className="text-base font-medium">Your characters</h2>
          <p className="text-sm text-muted-foreground">Create and manage your party.</p>
        </Link>
      </div>

      <section aria-label="Your adventures" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Your adventures</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : adventures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet — create an adventure or join one with an invite link.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {adventures.map((adventure) => (
              <li key={adventure.id}>
                <Link
                  to={adventureLink(adventure)}
                  className="flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-ring hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{adventure.title || 'Untitled adventure'}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {STATUS_LABELS[adventure.status] ?? adventure.status}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {adventure.mode === 'full_ai' ? 'Full-AI DM' : adventure.mode === 'assist' ? 'AI-Assist' : '—'} ·{' '}
                    {adventure.minPlayers}–{adventure.maxPlayers} players
                    {adventure.isDemo && ' · demo'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
