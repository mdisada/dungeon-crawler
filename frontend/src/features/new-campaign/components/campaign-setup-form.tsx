import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    isGeneratingOutline,
    generatePlotIdea,
    generateCampaignOutline,
  } = manager

  const boundsValid =
    setup.campaignType === 'one-shot' ||
    (setup.minChapters <= setup.maxChapters &&
      setup.minSessionsPerChapter <= setup.maxSessionsPerChapter &&
      setup.minChapters >= 1 &&
      setup.minSessionsPerChapter >= 1)

  const canGenerateOutline =
    Boolean(setup.model) && setup.plot.trim().length > 0 && boundsValid && !isGeneratingOutline

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (canGenerateOutline) generateCampaignOutline()
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
            : 'A full campaign spanning multiple chapters, each with multiple sessions.'}
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
              variant="outline"
              size="sm"
              disabled={!setup.model || isGeneratingPlot}
              onClick={generatePlotIdea}
            >
              {isGeneratingPlot ? 'Generating…' : 'Generate random plot'}
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

      {/* Bounds — only meaningful for multi-chapter; the backend picks one exact count within
          these bounds and tells the model that exact number rather than a range. */}
      {setup.campaignType === 'multi-chapter' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              label="Min chapters"
              value={setup.minChapters}
              onChange={(v) => updateSetup({ minChapters: v })}
            />
            <NumberField
              label="Max chapters"
              value={setup.maxChapters}
              onChange={(v) => updateSetup({ maxChapters: v })}
            />
            <NumberField
              label="Min sessions / chapter"
              value={setup.minSessionsPerChapter}
              onChange={(v) => updateSetup({ minSessionsPerChapter: v })}
            />
            <NumberField
              label="Max sessions / chapter"
              value={setup.maxSessionsPerChapter}
              onChange={(v) => updateSetup({ maxSessionsPerChapter: v })}
            />
          </div>

          {!boundsValid && (
            <p className="text-sm text-destructive">
              Each min must be at least 1 and no greater than its matching max.
            </p>
          )}
        </>
      )}

      <Button type="submit" disabled={!canGenerateOutline}>
        {isGeneratingOutline ? 'Generating outline…' : 'Generate campaign outline'}
      </Button>
    </form>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
