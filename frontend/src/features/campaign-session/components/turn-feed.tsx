import type { Turn } from '../types'

type Props = {
  turns: Turn[]
  isLoading: boolean
}

export function TurnFeed({ turns, isLoading }: Props) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading story so far…</p>

  if (turns.length === 0) {
    return <p className="text-sm text-muted-foreground">The story hasn't started yet.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn) =>
        turn.author === 'player' ? (
          <p
            key={turn.id}
            className="ml-8 whitespace-pre-wrap rounded-lg border border-primary/30 bg-primary/5 p-4 text-left"
          >
            {turn.content}
          </p>
        ) : (
          <p key={turn.id} className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-left">
            {turn.content}
          </p>
        ),
      )}
    </div>
  )
}
