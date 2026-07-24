import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { listReusableAdventures } from '../api/lab-runs'
import { DEFAULT_RUN_CONFIG, GENRE_PLOTS } from '../types'
import type { LabRunConfig, ReusableAdventure } from '../types'

interface RunFormProps {
  onQueue: (config: LabRunConfig) => Promise<void>
}

export function RunForm({ onQueue }: RunFormProps) {
  const [config, setConfig] = useState<LabRunConfig>(DEFAULT_RUN_CONFIG)
  const [reusable, setReusable] = useState<ReusableAdventure[]>([])
  const [isQueueing, setIsQueueing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listReusableAdventures()
      .then((rows) => { if (!cancelled) setReusable(rows) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const set = (patch: Partial<LabRunConfig>) => setConfig((prev) => ({ ...prev, ...patch }))

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsQueueing(true)
    setError(null)
    try {
      await onQueue(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue run')
    } finally {
      setIsQueueing(false)
    }
  }

  const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">New simulated playthrough</h2>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant={config.mode === 'new' ? 'default' : 'outline'}
          onClick={() => set({ mode: 'new', adventure_id: undefined })}>
          Generate new
        </Button>
        <Button type="button" size="sm" variant={config.mode === 'existing' ? 'default' : 'outline'}
          onClick={() => set({ mode: 'existing', adventure_id: reusable[0]?.adventureId })}
          disabled={reusable.length === 0}>
          Replay existing {reusable.length === 0 ? '(none yet)' : ''}
        </Button>
      </div>

      {config.mode === 'new' ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lab-genre">Genre preset</Label>
            <select id="lab-genre" className={selectClass}
              value={config.plot?.key ?? 'murder'}
              onChange={(e) => set({ plot: GENRE_PLOTS.find((p) => p.key === e.target.value) })}>
              {GENRE_PLOTS.map((p) => <option key={p.key} value={p.key}>{p.key} — {p.title}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lab-idea">Plot idea (editable)</Label>
            <Textarea id="lab-idea" rows={3} value={config.plot?.idea ?? ''}
              onChange={(e) => set({ plot: { ...(config.plot ?? GENRE_PLOTS[0]), idea: e.target.value } })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lab-type">Length</Label>
            <select id="lab-type" className={selectClass} value={config.type}
              onChange={(e) => set({ type: e.target.value as LabRunConfig['type'] })}>
              <option value="one_shot">One-shot (1 chapter)</option>
              <option value="multi_chapter">Multi-chapter</option>
            </select>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-adventure">Adventure</Label>
          <select id="lab-adventure" className={selectClass} value={config.adventure_id ?? ''}
            onChange={(e) => set({ adventure_id: e.target.value })}>
            {reusable.map((a) => <option key={a.adventureId} value={a.adventureId}>{a.title}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-quality">Player quality</Label>
          <select id="lab-quality" className={selectClass} value={config.quality}
            onChange={(e) => set({ quality: e.target.value as LabRunConfig['quality'] })}>
            <option value="mixed">Mixed (30/40/30)</option>
            <option value="poor">Poor</option>
            <option value="mediocre">Mediocre</option>
            <option value="good">Good</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-party">Party size</Label>
          <select id="lab-party" className={selectClass} value={config.party_size}
            onChange={(e) => set({ party_size: Number(e.target.value) })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-turns">Turn cap</Label>
          <Input id="lab-turns" type="number" min={4} max={60} value={config.turns}
            onChange={(e) => set({ turns: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-budget">Budget (USD)</Label>
          <Input id="lab-budget" type="number" min={0.1} max={5} step={0.05} value={config.budget_usd}
            onChange={(e) => set({ budget_usd: Number(e.target.value) })} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="lab-model">Model (all agents + simulated player)</Label>
        <Input id="lab-model" value={config.model} onChange={(e) => set({ model: e.target.value })} />
      </div>

      <Button type="submit" disabled={isQueueing}>
        {isQueueing ? 'Queueing…' : 'Queue run'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Runs execute one at a time via the local watcher: <code>node tests/lab/lab-runner.mjs</code>
      </p>
    </form>
  )
}
