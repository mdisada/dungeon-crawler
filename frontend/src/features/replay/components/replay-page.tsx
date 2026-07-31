import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useSession } from '@/features/auth'
import { PlayPage } from '@/features/play'

import { getReplayableAdventure } from '../api/replay'
import { isReplayUser } from '../debug'
import type { ReplayableAdventure } from '../types'
import { ReplayDevPanel } from './replay-dev-panel'

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; adventure: ReplayableAdventure }

/**
 * The real play screen, driven against a finished adventure. PlayPage is rendered UNCHANGED and
 * reads the same `:id` param it does under /adventures/:id/play - so every UI fix made while
 * sitting here is a fix to live play, not to a copy of it.
 */
export function ReplayPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useSession()
  const [page, setPage] = useState<PageState>({ status: 'loading' })

  const allowed = isReplayUser(user?.email)

  useEffect(() => {
    if (!id || !allowed) return
    let cancelled = false
    getReplayableAdventure(id)
      .then((adventure) => {
        if (cancelled) return
        if (!adventure) setPage({ status: 'error', message: 'Adventure not found (are you a member?)' })
        else setPage({ status: 'ready', adventure })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage({ status: 'error', message: err instanceof Error ? err.message : 'Failed to open adventure' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, allowed])

  if (!allowed) return <p className="text-sm text-muted-foreground">This page is not available.</p>
  if (!id) return null
  if (page.status === 'loading') return <p className="p-8 text-muted-foreground">Loading replay…</p>
  if (page.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-destructive">{page.message}</p>
        <Link to="/replay" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to replay list
        </Link>
      </div>
    )
  }

  return (
    <>
      <PlayPage />
      <ReplayDevPanel adventureId={id} adventureStatus={page.adventure.status} />
    </>
  )
}
