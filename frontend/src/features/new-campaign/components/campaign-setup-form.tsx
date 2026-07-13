import { History, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { useCampaignManager } from '../hooks/use-campaign-manager'
import type { useModelOptions } from '../hooks/use-model-options'
import type { PlotDraft } from '../types'
import { CostBadge } from './cost-badge'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
  models: ReturnType<typeof useModelOptions>
}

export function CampaignSetupForm({ manager, models }: Props) {
  const {
    setup,
    updateSetup,
    plotCost,
    isGeneratingPlot,
    isImprovingPlot,
    isGeneratingPlotPoints,
    plotHistoryStack,
    plotDrafts,
    isLoadingHistory,
    generatePlotIdea,
    improvePlotText,
    undoPlot,
    loadPlotHistory,
    restoreFromHistory,
    generateCampaignPlotPoints,
  } = manager

  const canGenerateOutline =
    Boolean(setup.model) && setup.plot.trim().length > 0 && !isGeneratingPlotPoints

  const isPlotEmpty = setup.plot.trim().length === 0
  const isBusyWithPlot = isGeneratingPlot || isImprovingPlot

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (canGenerateOutline) generateCampaignPlotPoints()
      }}
    >
      {/* Model picker */}
      <div className="flex flex-col gap-2">
        <Label>AI model</Label>
        {models.status === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading models…</p>
        )}
        {models.status === 'error' && (
          <p className="text-sm text-destructive">Could not load models: {models.error}</p>
        )}
        {models.status === 'ready' && (
          <Select
            value={setup.model || null}
            onValueChange={(value) => updateSetup({ model: (value as string) ?? '' })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {models.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Campaign type */}
      <div className="flex flex-col gap-2">
        <Label>Campaign type</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={setup.campaignType === 'one-shot' ? 'default' : 'outline'}
            onClick={() => updateSetup({ campaignType: 'one-shot' })}
          >
            One-shot
          </Button>
          <Button
            type="button"
            variant={setup.campaignType === 'multi-chapter' ? 'default' : 'outline'}
            onClick={() => updateSetup({ campaignType: 'multi-chapter' })}
          >
            Multi-chapter campaign
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {setup.campaignType === 'one-shot'
            ? 'A single self-contained story, told in one session.'
            : 'A full campaign guided by a handful of major story beats, spanning many sessions.'}
        </p>
      </div>

      {/* Plot idea */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="plot">Plot idea</Label>
          <div className="flex items-center gap-2">
            {plotCost !== null && <CostBadge cost={plotCost} />}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Undo last plot change"
              disabled={plotHistoryStack.length === 0}
              onClick={undoPlot}
            >
              <Undo2 />
            </Button>
            <Popover onOpenChange={(open) => open && loadPlotHistory()}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show plot history"
                  />
                }
              >
                <History />
              </PopoverTrigger>
              <PopoverContent>
                <PlotHistoryList
                  drafts={plotDrafts}
                  isLoading={isLoadingHistory}
                  onRestore={restoreFromHistory}
                />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!setup.model || isBusyWithPlot}
              onClick={isPlotEmpty ? generatePlotIdea : improvePlotText}
            >
              {isBusyWithPlot
                ? isPlotEmpty
                  ? 'Generating…'
                  : 'Improving…'
                : isPlotEmpty
                  ? 'Generate Plot'
                  : 'Improve Prompt'}
            </Button>
          </div>
        </div>
        <Textarea
          id="plot"
          value={setup.plot}
          onChange={(e) => updateSetup({ plot: e.target.value })}
          placeholder="Describe your campaign's plot, or generate a random one."
          rows={5}
        />
      </div>

      <Button type="submit" disabled={!canGenerateOutline}>
        {isGeneratingPlotPoints ? 'Generating…' : 'Generate story guide'}
      </Button>
    </form>
  )
}

function PlotHistoryList({
  drafts,
  isLoading,
  onRestore,
}: {
  drafts: PlotDraft[]
  isLoading: boolean
  onRestore: (draft: PlotDraft) => void
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading history…</p>
  }

  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">No previous drafts yet.</p>
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Your plot history</p>
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {drafts.map((draft) => (
          <PopoverClose
            key={draft.id}
            render={
              <button
                type="button"
                className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => onRestore(draft)}
              />
            }
          >
            <span className="line-clamp-2 text-sm">{draft.content}</span>
            <span className="text-xs text-muted-foreground">
              {sourceLabel(draft.source)} · {new Date(draft.createdAt).toLocaleString()}
            </span>
          </PopoverClose>
        ))}
      </div>
    </div>
  )
}

function sourceLabel(source: PlotDraft['source']): string {
  switch (source) {
    case 'generated':
      return 'Generated'
    case 'improved':
      return 'Improved'
    default:
      return 'Written'
  }
}
