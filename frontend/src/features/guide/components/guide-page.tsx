import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { validateGuideReady } from '@rules/guide'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { activateAdventure } from '@/features/play'
import { startPipeline } from '../api/pipeline'
import { useGuide } from '../hooks/use-guide'
import { EndingsTab } from './endings-tab'
import { IngredientsDrawer } from './ingredients-drawer'
import { LocationsTab } from './locations-tab'
import { NpcsTab } from './npcs-tab'
import { PipelineProgress } from './pipeline-progress'
import { PlotTab } from './plot-tab'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  generating: 'Generating…',
  guide_ready: 'Guide ready',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
}

// F04 SS5: the Adventure Guide editor at /adventures/:id/guide - header with status/progress
// and Start Adventure CTA, three tabs, and the ingredients drawer available on all of them.
export function GuidePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state, refresh } = useGuide(id)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'loading') return <p className="p-8 text-muted-foreground">Loading guide…</p>
  if (state.status === 'error') return <p className="p-8 text-destructive">{state.message}</p>

  const { data } = state
  const isGenerating = data.jobs.some((j) => j.status === 'queued' || j.status === 'running')
  // Show progress while jobs are in flight AND once the queue pauses on a failure - a failed
  // stage has no queued/running job, so gating purely on isGenerating would hide the error and
  // its retry button, leaving the header stuck on "Generating..." with empty tabs.
  const showPipeline = data.jobs.some((j) => j.status !== 'done')

  async function validateStart() {
    const errors = validateGuideReady({
      chapters: data.chapters.map((c) => ({
        title: c.title,
        objectives: data.objectives
          .filter((o) => o.chapterId === c.id)
          .map((o) => ({ title: o.title, completionPredicates: o.completionPredicates })),
      })),
      locationCount: data.locations.length,
      endingCount: data.endings.length,
      contracts: data.contracts.map((k) => ({
        label: k.label,
        isEntry: k.isEntry,
        giverNpcId: k.giverNpcId,
        goldFloor: k.reward.gold_floor ?? 0,
        goldCeiling: k.reward.gold_ceiling ?? 0,
        objectiveIds: k.objectiveIds,
      })),
      npcIds: data.npcs.map((n) => n.id),
      objectiveIds: data.objectives.map((o) => o.id),
    })
    setValidationErrors(errors)
    if (errors.length > 0 || !id) return
    // Valid guide -> activate (membership + state bootstrap) and open the lobby (F05).
    setIsStarting(true)
    setError(null)
    try {
      await activateAdventure(id)
      navigate(`/adventures/${id}/play`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the lobby')
    } finally {
      setIsStarting(false)
    }
  }

  async function restartPipeline() {
    if (!id) return
    if (!window.confirm('Regenerate the whole guide? All generated content (and your edits) will be replaced.')) return
    setIsRestarting(true)
    setError(null)
    try {
      await startPipeline(id)
      setValidationErrors(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart the pipeline')
    } finally {
      setIsRestarting(false)
    }
  }

  // Stage-8 reachability warnings render inside the Endings tab, not in the header.
  const guideWarnings = data.warnings.filter((w) => !w.resolved && !w.targetId && w.stage !== 8)

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 px-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Adventure Guide</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{STATUS_LABELS[data.adventure.status] ?? data.adventure.status}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsDrawerOpen((v) => !v)} aria-expanded={isDrawerOpen}>
            Ingredients ({data.ingredients.length})
          </Button>
          {data.adventure.status === 'guide_ready' && (
            <Button variant="outline" size="sm" disabled={isRestarting} onClick={() => void restartPipeline()}>
              Regenerate guide
            </Button>
          )}
          {data.adventure.status === 'active' ? (
            <Button size="sm" onClick={() => navigate(`/adventures/${id}/play`)}>
              Open table
            </Button>
          ) : (
            <Button size="sm" disabled={isGenerating || isStarting} onClick={() => void validateStart()}>
              {isStarting ? 'Opening lobby…' : 'Start Adventure'}
            </Button>
          )}
        </div>
      </header>

      {validationErrors !== null && validationErrors.length > 0 && (
        <div className="rounded-md border border-destructive/40 p-3 text-sm">
          <p className="font-medium text-destructive">The guide is not ready yet:</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {validationErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {showPipeline && <PipelineProgress jobs={data.jobs} chapters={data.chapters} onChanged={() => void refresh()} />}

      {guideWarnings.length > 0 && (
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <h2 className="font-medium">Consistency warnings</h2>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {guideWarnings.map((w) => (
              <li key={w.id}>{w.message}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <Tabs defaultValue="plot">
            <TabsList>
              <TabsTab value="plot">Plot &amp; Objectives</TabsTab>
              <TabsTab value="npcs">NPCs ({data.npcs.length})</TabsTab>
              <TabsTab value="locations">Locations ({data.locations.length})</TabsTab>
              <TabsTab value="endings">Endings ({data.endings.length})</TabsTab>
            </TabsList>
            <TabsPanel value="plot">
              <PlotTab data={data} onChanged={() => void refresh()} />
            </TabsPanel>
            <TabsPanel value="npcs">
              <NpcsTab data={data} onChanged={() => void refresh()} />
            </TabsPanel>
            <TabsPanel value="locations">
              <LocationsTab data={data} onChanged={() => void refresh()} />
            </TabsPanel>
            <TabsPanel value="endings">
              <EndingsTab data={data} onChanged={() => void refresh()} />
            </TabsPanel>
          </Tabs>
        </div>
        {isDrawerOpen && (
          <aside className="w-80 shrink-0 rounded-lg border p-3" aria-label="Ingredients drawer">
            <IngredientsDrawer data={data} onChanged={() => void refresh()} />
          </aside>
        )}
      </div>
    </div>
  )
}
