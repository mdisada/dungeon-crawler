import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { regenerateRow } from '../api/pipeline'
import { deleteGuideRow, saveGuideRow } from '../api/save-guide-row'
import type { GuideWarning, Objective } from '../types'
import { PredicateEditor } from './predicate-editor'
import { RegenBanner } from './regen-banner'

interface ObjectiveRowProps {
  objective: Objective
  warnings: GuideWarning[]
  npcNames: string[]
  locationNames: string[]
  onChanged: () => void
}

export function ObjectiveRow({ objective, warnings, npcNames, locationNames, onChanged }: ObjectiveRowProps) {
  const [title, setTitle] = useState(objective.title)
  const [hiddenDescription, setHiddenDescription] = useState(objective.hiddenDescription)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<unknown>) {
    setIsBusy(true)
    setError(null)
    try {
      await work()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Objective title"
          className="max-w-xs font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== objective.title) void run(() => saveGuideRow('objectives', objective.id, { title }))
          }}
        />
        <PredicateEditor
          value={objective.completionPredicates}
          onSave={(predicate) => saveGuideRow('objectives', objective.id, { completion_predicates: predicate }).then(onChanged)}
        />
        <Button variant="ghost" size="sm" onClick={() => setIsExpanded((v) => !v)}>
          {isExpanded ? 'Hide details' : 'Details'}
        </Button>
        <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => void run(() => regenerateRow('objectives', objective.id))}>
          Regenerate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={isBusy}
          onClick={() => void run(() => deleteGuideRow('objectives', objective.id))}
        >
          Delete
        </Button>
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w.id} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
              Consistency: {w.message}
            </li>
          ))}
        </ul>
      )}

      {(npcNames.length > 0 || locationNames.length > 0) && (
        <div className="flex flex-wrap gap-1 text-xs">
          {npcNames.map((n) => (
            <span key={`n-${n}`} className="rounded-full bg-muted px-2 py-0.5">
              {n}
            </span>
          ))}
          {locationNames.map((l) => (
            <span key={`l-${l}`} className="rounded-full bg-muted px-2 py-0.5">
              {l}
            </span>
          ))}
        </div>
      )}

      {isExpanded && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Hidden description (DM only)
          <Textarea
            className="min-h-24 text-sm text-foreground"
            value={hiddenDescription}
            onChange={(e) => setHiddenDescription(e.target.value)}
            onBlur={() => {
              if (hiddenDescription !== objective.hiddenDescription) {
                void run(() => saveGuideRow('objectives', objective.id, { hidden_description: hiddenDescription }))
              }
            }}
          />
        </label>
      )}

      {objective.pendingRegen && (
        <RegenBanner
          table="objectives"
          rowId={objective.id}
          current={{
            title: objective.title,
            hidden_description: objective.hiddenDescription,
            completion_predicates: objective.completionPredicates,
          }}
          pendingRegen={objective.pendingRegen}
          onResolved={onChanged}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  )
}
