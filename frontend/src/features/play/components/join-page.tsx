import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { joinByInvite } from '../api/session'

/** F05 SS2: /join/:inviteCode - joins (capacity-checked server-side) and enters the adventure. */
export function JoinPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    joinByInvite(code)
      .then((result) => {
        if (!cancelled) navigate(`/adventures/${result.adventure_id}/play`, { replace: true })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not join')
      })
    return () => {
      cancelled = true
    }
  }, [code, navigate])

  if (error)
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-destructive">{error}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </div>
    )
  return <p className="p-8 text-muted-foreground">Joining adventure…</p>
}
