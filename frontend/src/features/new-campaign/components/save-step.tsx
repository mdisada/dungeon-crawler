import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { useCampaignManager } from '../hooks/use-campaign-manager'
import { CostBadge } from './cost-badge'
import { PlotPointsView } from './plot-points-view'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
}

export function SaveStep({ manager }: Props) {
  const { plotPoints, generationCost, savedCampaignId } = manager

  if (!plotPoints) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Story guide</h2>
        {generationCost !== null && <CostBadge cost={generationCost} />}
      </div>

      <PlotPointsView plotPoints={plotPoints} />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm">Campaign saved (id #{savedCampaignId}). You can build on it later.</p>
        <Button render={<Link to="/" />}>Back to home</Button>
      </div>
    </div>
  )
}
