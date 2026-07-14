import { Link, Navigate, useParams } from 'react-router-dom'
import { useSession } from '@/features/auth'
import { useAutoPlotNarration } from '../hooks/use-auto-plot-narration'
import { useCampaign } from '../hooks/use-campaign'
import { useCampaignTurns } from '../hooks/use-campaign-turns'
import { useLiveNarrationAudio } from '../hooks/use-live-narration-audio'
import { TurnFeed } from './turn-feed'

export function CampaignPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const { user } = useSession()
  const { campaign, isLoading: isCampaignLoading, error: campaignError } = useCampaign(campaignId)
  const { turns, isLoading: areTurnsLoading } = useCampaignTurns(campaignId)
  const { audioRef } = useLiveNarrationAudio(campaignId)
  // First time the campaign is played (no turns yet): read the plot premise aloud. Gated on the
  // ownership check below so it can't fire for a campaign this page is about to redirect off of.
  const isOwnCampaign = !!campaign && campaign.userId === user?.id
  useAutoPlotNarration(campaignId, isOwnCampaign && !areTurnsLoading && turns.length === 0)

  if (isCampaignLoading) return null
  if (campaignError || !campaign) return <Navigate to="/" replace />
  if (campaign.userId !== user?.id) return <Navigate to="/" replace />

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div className="flex items-center justify-between">
        <div>

          <h1>{campaign.title ?? 'Untitled campaign'}</h1>
          <p className="text-lg">{campaign.plot}</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      <audio ref={audioRef} className="hidden" />
      <TurnFeed turns={turns} isLoading={areTurnsLoading} />
    </div>
  )
}
