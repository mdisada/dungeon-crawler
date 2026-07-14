import { Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { useCampaignManager } from '../hooks/use-campaign-manager'
import { CostBadge } from './cost-badge'
import { PuzzlesSection } from './puzzles-section'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
}

export function PlotPointsStep({ manager }: Props) {
  const {
    plotPoints,
    generationCost,
    locks,
    isRegenerating,
    isSaving,
    updatePlotPoint,
    togglePlotPointLock,
    regenerateUnlockedPlotPoints,
    saveGeneratedCampaign,
    backToSetup,
  } = manager

  if (!plotPoints || !locks) return null

  const allLocked = locks.length > 0 && locks.every(Boolean)
  const busy = isRegenerating || isSaving

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Story guide</h2>
          <p className="text-sm text-muted-foreground">
            The rough major beats guiding your story — everything in between is improvised live.
            Lock what you like, then regenerate the rest.
          </p>
        </div>
        {generationCost !== null && <CostBadge cost={generationCost} />}
      </div>

      <div className="flex flex-col gap-4 text-left">
        {plotPoints.map((point, index) => {
          const locked = locks[index] ?? false

          return (
            <div key={index} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <LockButton
                  locked={locked}
                  label={`Lock plot point ${index + 1}`}
                  onClick={() => togglePlotPointLock(index)}
                  disabled={busy}
                />
                <div className="flex flex-1 flex-col gap-3">
                  <span className="text-sm font-medium text-muted-foreground">
                    Plot point {index + 1}
                  </span>
                  <Input
                    value={point.title}
                    onChange={(e) => updatePlotPoint(index, { title: e.target.value })}
                    disabled={busy}
                    placeholder="Title"
                  />
                  <Textarea
                    value={point.summary}
                    onChange={(e) => updatePlotPoint(index, { summary: e.target.value })}
                    disabled={busy}
                    rows={2}
                    placeholder="Summary"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <PuzzlesSection manager={manager} busy={busy} />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || allLocked}
          onClick={regenerateUnlockedPlotPoints}
        >
          {isRegenerating
            ? 'Regenerating…'
            : allLocked
              ? 'Everything is locked'
              : 'Regenerate unlocked'}
        </Button>
        <Button onClick={saveGeneratedCampaign} disabled={busy}>
          {isSaving ? 'Saving…' : 'Save campaign'}
        </Button>
        <Button variant="outline" onClick={backToSetup} disabled={busy}>
          Back to setup
        </Button>
      </div>
    </div>
  )
}

function LockButton({
  locked,
  label,
  onClick,
  disabled,
}: {
  locked: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      aria-pressed={locked}
      disabled={disabled}
      onClick={onClick}
      className={locked ? 'text-primary' : 'text-muted-foreground'}
    >
      {locked ? <Lock /> : <Unlock />}
    </Button>
  )
}
