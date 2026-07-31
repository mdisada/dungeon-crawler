import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useSession } from '@/features/auth'

import { listReplayableAdventures } from '../api/replay'
import { isReplayUser } from '../debug'
import type { ReplayableAdventure } from '../types'

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; adventures: ReplayableAdventure[] }

/** Pick a finished adventure to re-open. Dev surface: everything it lists, it can mutate. */
export function ReplayPickerPage() {
  const { user } = useSession()
  const [page, setPage] = useState<PageState>({ status: 'loading' })

  const allowed = isReplayUser(user?.email)

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    listReplayableAdventures()
      .then((adventures) => !cancelled && setPage({ status: 'ready', adventures }))
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load adventures' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [allowed])

  if (!allowed) return <p className="text-sm text-muted-foreground">This page is not available.</p>
  if (page.status === 'loading') return <p className="text-muted-foreground">Loading adventures…</p>
  if (page.status === 'error') return <p className="text-destructive">{page.message}</p>

  return (
    <div className="w-full max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Replay</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Re-open a finished adventure on the real play screen to rehearse combat and iterate on the
        UI. Re-opening flips the adventure back to active; mark it completed again when you are
        done.
      </p>

      {page.adventures.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No adventure has reached play yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {page.adventures.map((adventure) => (
            <li key={adventure.id}>
              <Link
                to={`/replay/${adventure.id}`}
                className="flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-accent"
              >
                <span className="font-medium">{adventure.title}</span>
                <span className="text-xs text-muted-foreground">
                  {adventure.status}
                  {adventure.mode ? ` · ${adventure.mode === 'full_ai' ? 'Full AI' : 'Assist'}` : ''} ·{' '}
                  {new Date(adventure.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
