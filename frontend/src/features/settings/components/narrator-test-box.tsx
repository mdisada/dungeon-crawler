import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useNarratorTestBox } from '../hooks/use-narrator-test-box'

export function NarratorTestBox() {
  const [prompt, setPrompt] = useState('The party opens the ancient door.')
  const { state, run } = useNarratorTestBox()

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Test the AI gateway</h2>
      <p className="text-sm text-muted-foreground">
        Sends one real, streamed <code>agent_role: narrator</code> call through ai-proxy using
        your current model map.
      </p>
      <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} />
      <Button
        type="button"
        onClick={() => run(prompt)}
        disabled={state.status === 'streaming'}
        className="self-start"
      >
        {state.status === 'streaming' ? 'Streaming…' : 'Send test call'}
      </Button>
      {(state.status === 'streaming' || state.status === 'done') && (
        <p className="rounded border border-border p-3 whitespace-pre-wrap">{state.text}</p>
      )}
      {state.status === 'done' && (
        <p className="text-sm text-muted-foreground">Completed in {state.durationLabel}.</p>
      )}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.error}</p>}
    </section>
  )
}
