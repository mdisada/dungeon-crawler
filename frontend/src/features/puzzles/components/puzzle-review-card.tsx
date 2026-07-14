import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { PuzzleDefinition } from '../types'

type Props = {
  draft: PuzzleDefinition
  cost: number
  busy: boolean
  onUpdate: (patch: Partial<PuzzleDefinition>) => void
  onAdapt: () => void
  onSave: () => void
  onDiscard: () => void
}

export function PuzzleReviewCard({ draft, cost, busy, onUpdate, onAdapt, onSave, onDiscard }: Props) {
  const elementCount = draft.elements.length
  const winSummary = summarizeWinCondition(draft)

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {draft.presentation === 'map' ? 'Map puzzle' : 'Text puzzle'} · {draft.archetype}
        </span>
        {cost > 0 && (
          <span className="text-xs text-muted-foreground">Cost: ${cost.toFixed(4)}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="puzzle-title">Title</Label>
        <Input
          id="puzzle-title"
          value={draft.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="puzzle-description">Player-facing intro</Label>
        <Textarea
          id="puzzle-description"
          value={draft.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          disabled={busy}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-2">
        <div>
          <span className="font-medium">Elements:</span>{' '}
          {elementCount > 0 ? draft.elements.map((e) => e.name).join(', ') : 'none'}
        </div>
        <div>
          <span className="font-medium">Solved when:</span> {winSummary}
        </div>
        {draft.grid && (
          <div>
            <span className="font-medium">Grid:</span> {draft.grid.width}×{draft.grid.height}
          </div>
        )}
        <div>
          <span className="font-medium">Max attempts:</span> {draft.maxAttempts ?? 'unlimited'}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="puzzle-solution">Hidden solution (for free-text attempts)</Label>
        <Textarea
          id="puzzle-solution"
          value={draft.winCondition.solutionText ?? ''}
          onChange={(e) =>
            onUpdate({ winCondition: { ...draft.winCondition, solutionText: e.target.value || null } })
          }
          disabled={busy}
          rows={2}
          placeholder="Not used by this puzzle"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="puzzle-hints">Hints (one per line, vaguest first)</Label>
        <Textarea
          id="puzzle-hints"
          value={draft.hints.join('\n')}
          onChange={(e) => onUpdate({ hints: e.target.value.split('\n').filter((h) => h.trim()) })}
          disabled={busy}
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="puzzle-success">Success narration</Label>
        <Textarea
          id="puzzle-success"
          value={draft.successText}
          onChange={(e) => onUpdate({ successText: e.target.value })}
          disabled={busy}
          rows={2}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={onSave} disabled={busy}>
          Save puzzle
        </Button>
        <Button variant="outline" onClick={onAdapt} disabled={busy}>
          {busy ? 'Adapting…' : 'Adapt to my campaign'}
        </Button>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
      </div>
    </div>
  )
}

function summarizeWinCondition(draft: PuzzleDefinition): string {
  const parts: string[] = []
  if (draft.winCondition.requiredStates.length > 0) {
    parts.push(
      draft.winCondition.requiredStates.map((r) => `${r.elementId} = ${r.state}`).join(' and '),
    )
  }
  if (draft.winCondition.sequence) {
    parts.push(`sequence: ${draft.winCondition.sequence.elementIds.join(' → ')}`)
  }
  if (draft.winCondition.solutionText) {
    parts.push('a correct free-text answer')
  }
  return parts.length > 0 ? parts.join('; ') : 'engine/referee decides (no mechanical win set)'
}
