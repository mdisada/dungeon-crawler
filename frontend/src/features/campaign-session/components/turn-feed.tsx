import { useAudioChunkPlayer } from '../hooks/use-audio-chunk-player'
import type { Turn } from '../types'

type Props = {
  turns: Turn[]
  isLoading: boolean
}

function NarrationReplayButton({ turn }: { turn: Turn }) {
  const { audioRef, enqueue, reset } = useAudioChunkPlayer()

  const play = () => {
    reset()
    turn.audioChunks?.forEach(enqueue)
  }

  return (
    <>
      <audio ref={audioRef} className="hidden" />
      <button
        type="button"
        onClick={play}
        className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
      >
        ▶ Play narration
      </button>
    </>
  )
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
          <div key={turn.id} className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-left">
            {turn.content}
            {turn.audioChunks?.length ? <NarrationReplayButton turn={turn} /> : null}
          </div>
        ),
      )}
    </div>
  )
}
