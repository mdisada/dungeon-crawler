import { useNavigate } from 'react-router-dom'
import { useSession } from '@/features/auth'
import { DEBUG_PLAYER_EMAIL } from '../constants'
import { useMyCampaigns } from '../hooks/use-my-campaigns'
import type { CampaignSummary } from '../types'

function plotTitle(plot: string): string {
  return plot.length > 60 ? `${plot.slice(0, 60)}…` : plot
}

export function CampaignsList() {
  const { user } = useSession()
  const navigate = useNavigate()
  const { campaigns, isLoading, error } = useMyCampaigns(user?.id)
  const isDebugAccount = user?.email === DEBUG_PLAYER_EMAIL

  // Browsers only reliably allow one window.open() per user gesture — chaining a second call
  // in the same click handler gets it silently blocked. So the DM tab opens as part of the main
  // click, and the player tab (debug-only) gets its own separate button/gesture.
  const openCampaign = (campaign: CampaignSummary) => {
    const isDm = campaign.userId === user?.id
    navigate(`/campaigns/${campaign.id}`)
    if (isDm) window.open(`/campaigns/${campaign.id}/dm`, '_blank')
  }

  const openPlayerView = (campaign: CampaignSummary) => {
    window.open(`/campaigns/${campaign.id}/player`, '_blank')
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (campaigns.length === 0) {
    return <p className="text-sm text-muted-foreground">Campaigns you have created or joined will show up here.</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {campaigns.map((campaign) => {
        const isDm = campaign.userId === user?.id
        return (
          <li key={campaign.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openCampaign(campaign)}
              className="flex flex-1 items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:border-border hover:bg-accent"
            >
              <span>{plotTitle(campaign.plot)}</span>
              {isDm && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">DM</span>
              )}
            </button>
            {isDm && isDebugAccount && (
              <button
                type="button"
                onClick={() => openPlayerView(campaign)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                Open player
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
