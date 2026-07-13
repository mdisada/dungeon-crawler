import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePlayerResponse } from '../hooks/use-player-response'

type Props = {
  campaignId: number
}

export function PlayerResponseForm({ campaignId }: Props) {
  const { content, setContent, status, error, submit, justSubmitted } = usePlayerResponse(campaignId)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base">What do you do?</h2>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {justSubmitted && <p className="text-sm text-muted-foreground">Sent — the DM is weaving it into the story.</p>}

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Say or do something…"
        rows={3}
      />

      <Button onClick={submit} disabled={status !== 'idle' || !content.trim()} className="self-start">
        {status === 'sending' ? 'Sending…' : 'Send'}
      </Button>
    </div>
  )
}
