import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { useCampaignManager } from '../hooks/use-campaign-manager'
import { CostBadge } from './cost-badge'
import { OutlineView } from './outline-view'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
}

export function SaveStep({ manager }: Props) {
  const { setup, outline, outlineCost, chapterCount, sessionsPerChapter, savedCampaignId } = manager

  if (!outline) return null

  const isOneShot = setup.campaignType === 'one-shot'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{isOneShot ? 'Story outline' : 'Campaign outline'}</h2>
          {chapterCount !== null && sessionsPerChapter !== null && (
            <p className="text-sm text-muted-foreground">
              {isOneShot
                ? 'One-shot — a single session'
                : `${chapterCount} chapter${chapterCount === 1 ? '' : 's'} × ${sessionsPerChapter} session${sessionsPerChapter === 1 ? '' : 's'} each`}
            </p>
          )}
        </div>
        {outlineCost !== null && <CostBadge cost={outlineCost} />}
      </div>

      <OutlineView outline={outline} isOneShot={isOneShot} />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm">Campaign saved (id #{savedCampaignId}). You can build on it later.</p>
        <Button render={<Link to="/" />}>Back to home</Button>
      </div>
    </div>
  )
}
