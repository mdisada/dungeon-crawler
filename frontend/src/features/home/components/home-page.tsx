import { Link } from 'react-router-dom'
import { CampaignsList } from '@/features/campaign-session'

export function HomePage() {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <div>
        <h1>Welcome back</h1>
        <p className="text-lg">Pick up a campaign, start a new one, or manage your characters.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <Link
          to="/campaigns/new"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring hover:bg-accent"
        >
          <h2 className="text-base">New campaign</h2>
          <p className="text-sm text-muted-foreground">Start a new AI-run session from scratch.</p>
        </Link>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base">Your campaigns</h2>
          <div className="mt-2">
            <CampaignsList />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base">Your characters</h2>
          <p className="text-sm text-muted-foreground">Characters you have created will show up here.</p>
        </div>
      </div>
    </div>
  )
}
