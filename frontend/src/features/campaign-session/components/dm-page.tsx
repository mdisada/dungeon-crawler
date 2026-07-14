import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/features/auth'
import { useCampaign } from '../hooks/use-campaign'
import { useTurnDrafting } from '../hooks/use-turn-drafting'

// Full drafts run ~5 sentences — show only the first as a preview until the DM expands it.
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : text
}

export function DmPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const { user } = useSession()
  const { campaign, isLoading: isCampaignLoading, error: campaignError } = useCampaign(campaignId)
  const {
    options,
    draft,
    setDraft,
    feedback,
    setFeedback,
    status,
    error: draftError,
    autoPublishSecondsLeft,
    cancelAutoPublish,
    generateOptions,
    generate,
    publish,
  } = useTurnDrafting(campaignId)
  const [isExpanded, setIsExpanded] = useState(false)

  if (isCampaignLoading) return null
  if (campaignError || !campaign) return <Navigate to="/" replace />
  if (campaign.userId !== user?.id) return <Navigate to="/" replace />

  // Every fresh draft starts collapsed — only typing after expanding should keep it open.
  const runGenerate = async (withFeedback?: string, opts?: { autoPublish?: boolean }) => {
    await generate(withFeedback, opts)
    setIsExpanded(false)
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h1>DM view — {campaign.title ?? 'Untitled campaign'}</h1>
          <p className="text-lg">{campaign.plot}</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base">Next turn</h2>

        {draftError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {draftError}
          </p>
        )}

        {draft ? (
          <>
            {isExpanded ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write the next narration beat yourself…"
                rows={6}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="rounded-md border border-border bg-background p-3 text-left text-sm hover:border-primary/50"
              >
                {firstSentence(draft)} <span className="text-muted-foreground underline">Show full text</span>
              </button>
            )}

            {autoPublishSecondsLeft !== null && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                Publishing to players in {autoPublishSecondsLeft}s — edit the draft to cancel.
                <button type="button" onClick={cancelAutoPublish} className="underline">
                  Cancel
                </button>
              </p>
            )}

            <div className="flex gap-2">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Tell the AI how to change this draft…"
                rows={1}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => runGenerate(feedback)}
                disabled={status !== 'idle' || !feedback.trim()}
              >
                {status === 'generating' ? 'Regenerating…' : 'Regenerate with feedback'}
              </Button>
            </div>

            <Button onClick={publish} disabled={status !== 'idle' || !draft.trim()} className="self-start">
              {status === 'publishing' ? 'Publishing…' : 'Publish to players'}
            </Button>
          </>
        ) : options.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {status === 'generating' ? 'Generating the full draft…' : 'Pick a direction, or write your own below.'}
            </p>

            <div className="flex flex-col gap-2">
              {options.map((option, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => runGenerate(option, { autoPublish: true })}
                  disabled={status !== 'idle'}
                  className="rounded-md border border-border bg-background p-3 text-left text-sm hover:border-primary/50 disabled:opacity-50"
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="…or write your own direction"
                rows={1}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => runGenerate(feedback, { autoPublish: true })}
                disabled={status !== 'idle' || !feedback.trim()}
              >
                {status === 'generating' ? 'Generating…' : 'Use this instead'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Directions appear here automatically once a player responds, or ask for some now.
            </p>
            <Button variant="outline" onClick={generateOptions} disabled={status !== 'idle'} className="self-start">
              {status === 'loading-options' ? 'Loading directions…' : 'Suggest directions'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
