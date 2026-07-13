import { Link } from 'react-router-dom'
import { useCampaignManager } from '../hooks/use-campaign-manager'
import { useModelOptions } from '../hooks/use-model-options'
import { CampaignSetupForm } from './campaign-setup-form'
import { PlotPointsStep } from './plot-points-step'
import { SaveStep } from './save-step'

export function NewCampaignPage() {
  const manager = useCampaignManager()
  const models = useModelOptions()

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div className="flex items-center justify-between">
        <div>
          <h1>New campaign</h1>
          <p className="text-lg">Generate an AI-run campaign from a plot idea.</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      {manager.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {manager.error}
        </p>
      )}

      {manager.step === 'setup' ? (
        <CampaignSetupForm manager={manager} models={models} />
      ) : manager.step === 'plot-points' ? (
        <PlotPointsStep manager={manager} />
      ) : (
        <SaveStep manager={manager} />
      )}
    </div>
  )
}
