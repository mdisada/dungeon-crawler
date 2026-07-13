import { Link, Navigate, useParams } from 'react-router-dom'
import { useSession } from '@/features/auth'
import { useCampaign } from '../hooks/use-campaign'
import { useCampaignTurns } from '../hooks/use-campaign-turns'
import { PlayerResponseForm } from './player-response-form'
import { TurnFeed } from './turn-feed'

export function CampaignPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const { user } = useSession()
  const { campaign, isLoading: isCampaignLoading, error: campaignError } = useCampaign(campaignId)
  const { turns, isLoading: areTurnsLoading } = useCampaignTurns(campaignId)

  if (isCampaignLoading) return null
  if (campaignError || !campaign) return <Navigate to="/" replace />
  if (campaign.userId !== user?.id) return <Navigate to="/" replace />

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h1>Campaign #{campaign.id}</h1>
          <p className="text-lg">{campaign.plot}</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      <TurnFeed turns={turns} isLoading={areTurnsLoading} />
      <PlayerResponseForm campaignId={campaignId} />
    </div>
  )
}
