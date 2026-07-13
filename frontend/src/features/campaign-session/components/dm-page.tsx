import { Link, Navigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/features/auth'
import { useCampaign } from '../hooks/use-campaign'
import { useCampaignTurns } from '../hooks/use-campaign-turns'
import { useTurnDrafting } from '../hooks/use-turn-drafting'
import { TurnFeed } from './turn-feed'

export function DmPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const { user } = useSession()
  const { campaign, isLoading: isCampaignLoading, error: campaignError } = useCampaign(campaignId)
  const { turns, isLoading: areTurnsLoading } = useCampaignTurns(campaignId)
  const {
    draft,
    setDraft,
    feedback,
    setFeedback,
    status,
    error: draftError,
    generate,
    publish,
  } = useTurnDrafting(campaignId)

  if (isCampaignLoading) return null
  if (campaignError || !campaign) return <Navigate to="/" replace />
  if (campaign.userId !== user?.id) return <Navigate to="/" replace />

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h1>DM view — Campaign #{campaign.id}</h1>
          <p className="text-lg">{campaign.plot}</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      <TurnFeed turns={turns} isLoading={areTurnsLoading} />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base">Next turn</h2>
        <p className="text-sm text-muted-foreground">
          A draft appears here automatically once a player responds. Edit it directly, or tell the AI what to
          change and regenerate.
        </p>

        {draftError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {draftError}
          </p>
        )}

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Generate a draft, or write the next narration beat yourself…"
          rows={6}
        />

        <div className="flex gap-2">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell the AI how to change this draft…"
            rows={1}
            className="flex-1"
          />
          <Button variant="outline" onClick={() => generate(feedback)} disabled={status !== 'idle' || !feedback.trim()}>
            {status === 'generating' ? 'Regenerating…' : 'Regenerate with feedback'}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => generate()} disabled={status !== 'idle'}>
            {status === 'generating' ? 'Generating…' : 'Generate AI turn'}
          </Button>
          <Button onClick={publish} disabled={status !== 'idle' || !draft.trim()}>
            {status === 'publishing' ? 'Publishing…' : 'Publish to players'}
          </Button>
        </div>
      </div>
    </div>
  )
}
