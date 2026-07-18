import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { guideRequirementsMissing } from '../adventure-validation'
import { useAdventureDraft } from '../hooks/use-adventure-draft'
import { ModeSelectSection } from './mode-select-section'
import { PlayersSection } from './players-section'
import { PlotSection } from './plot-section'
import { TypeSection } from './type-section'

// F03 SS2: single page at /adventures/new, four sections top-to-bottom, one primary CTA.
export function NewAdventurePage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const userId = session?.user.id
  const { adventureId, draft, isLoading, isSaving, error, updateDraft, startGeneration } =
    useAdventureDraft(userId)

  if (isLoading) {
    return <p className="p-8 text-muted-foreground">Loading…</p>
  }

  if (error && !adventureId) {
    return <p className="p-8 text-destructive">{error}</p>
  }

  const missing = guideRequirementsMissing(draft)

  async function handleGenerate() {
    await startGeneration()
    navigate(`/adventures/${adventureId}`)
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1>New adventure</h1>
          <p className="text-muted-foreground">
            Set the shape of the adventure, then iterate on a plot until it's worth playing.
          </p>
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {isSaving ? 'Saving…' : 'Saved'}
        </span>
      </div>

      <ModeSelectSection draft={draft} updateDraft={updateDraft} />
      <PlayersSection draft={draft} updateDraft={updateDraft} />
      <TypeSection draft={draft} updateDraft={updateDraft} />
      {adventureId && <PlotSection adventureId={adventureId} draft={draft} updateDraft={updateDraft} />}

      <div className="flex flex-col gap-2 border-t pt-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {missing.length > 0 ? missing.join(' · ') : 'Everything is set.'}
          </p>
          <Button
            type="button"
            size="lg"
            disabled={missing.length > 0 || isSaving}
            onClick={() => void handleGenerate()}
          >
            Generate Adventure Guide
          </Button>
        </div>
        {error && adventureId && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
