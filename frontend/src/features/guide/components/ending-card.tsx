import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { regenerateRow } from '../api/pipeline'
import { deleteGuideRow, saveGuideRow } from '../api/save-guide-row'
import type { Ending, EndingSignal, EndingSignalWhen, Npc, Objective, StoryDial } from '../types'
import { RegenBanner } from './regen-banner'

interface EndingCardProps {
  ending: Ending
  objectives: Objective[]
  npcs: Npc[]
  dials: StoryDial[]
  onChanged: () => void
}

const NPC_STATES = ['dead', 'alive', 'allied', 'hostile'] as const
const OBJECTIVE_OUTCOMES = ['completed', 'failed'] as const

type SignalKind = 'objective' | 'npc' | 'dial'

function signalKind(when: EndingSignalWhen): SignalKind {
  if ('objective_id' in when) return 'objective'
  if ('npc_id' in when) return 'npc'
  return 'dial'
}

function defaultWhen(kind: SignalKind, objectives: Objective[], npcs: Npc[], dials: StoryDial[]): EndingSignalWhen {
  if (kind === 'objective') return { objective_id: objectives[0]?.id ?? null, outcome: 'completed' }
  if (kind === 'npc') return { npc_id: npcs[0]?.id ?? null, state: 'dead' }
  return { dial: dials[0]?.key ?? '', gte: 3 }
}

export function EndingCard({ ending, objectives, npcs, dials, onChanged }: EndingCardProps) {
  const [fields, setFields] = useState({
    title: ending.title,
    description: ending.description,
    climaxSummary: ending.climaxSummary,
    tone: ending.tone,
    summary: ending.triggerConditions.summary,
  })
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<unknown>) {
    setIsBusy(true)
    setError(null)
    try {
      await work()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsBusy(false)
    }
  }

  const signals = ending.triggerConditions.signals

  function saveSignals(next: EndingSignal[]) {
    return saveGuideRow('endings', ending.id, { trigger_conditions: { summary: fields.summary, signals: next } })
  }
  const updateSignal = (i: number, patch: Partial<EndingSignal>) =>
    run(() => saveSignals(signals.map((s, j) => (j === i ? { ...s, ...patch } : s))))

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Ending title"
          className="max-w-xs font-semibold"
          value={fields.title}
          onChange={(e) => setFields((p) => ({ ...p, title: e.target.value }))}
          onBlur={() => fields.title !== ending.title && void run(() => saveGuideRow('endings', ending.id, { title: fields.title }))}
        />
        <Input
          aria-label="Tone"
          className="w-32 text-sm"
          value={fields.tone}
          onChange={(e) => setFields((p) => ({ ...p, tone: e.target.value }))}
          onBlur={() => fields.tone !== ending.tone && void run(() => saveGuideRow('endings', ending.id, { tone: fields.tone }))}
        />
        {ending.isEmergent && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs">emergent</span>}
        {ending.status !== 'candidate' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{ending.status}</span>
        )}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => void run(() => regenerateRow('endings', ending.id))}>
            Regenerate
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={isBusy} onClick={() => void run(() => deleteGuideRow('endings', ending.id))}>
            Delete
          </Button>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Resolution premise (canonical)
        <Textarea
          className="min-h-16 text-sm text-foreground"
          value={fields.description}
          onChange={(e) => setFields((p) => ({ ...p, description: e.target.value }))}
          onBlur={() => fields.description !== ending.description && void run(() => saveGuideRow('endings', ending.id, { description: fields.description }))}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Climax sketch (illustrative - the real finale is written live at commitment)
        <Textarea
          className="min-h-16 text-sm text-foreground"
          value={fields.climaxSummary}
          onChange={(e) => setFields((p) => ({ ...p, climaxSummary: e.target.value }))}
          onBlur={() => fields.climaxSummary !== ending.climaxSummary && void run(() => saveGuideRow('endings', ending.id, { climax_summary: fields.climaxSummary }))}
        />
      </label>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Trigger signals (what play leads here)</h3>
        <Input
          aria-label="Trigger summary"
          className="text-sm"
          placeholder="One line: what kind of play leads to this ending"
          value={fields.summary}
          onChange={(e) => setFields((p) => ({ ...p, summary: e.target.value }))}
          onBlur={() => fields.summary !== ending.triggerConditions.summary && void run(() => saveSignals(signals))}
        />
        <ul className="flex flex-col gap-2">
          {signals.map((signal, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
              <select
                aria-label="Signal type"
                className="rounded border bg-background px-1 py-1 text-xs"
                value={signalKind(signal.when)}
                onChange={(e) => void updateSignal(i, { when: defaultWhen(e.target.value as SignalKind, objectives, npcs, dials) })}
              >
                <option value="objective">Objective</option>
                <option value="npc">NPC</option>
                <option value="dial">Dial</option>
              </select>

              {'objective_id' in signal.when && (
                <>
                  <select
                    aria-label="Objective"
                    className="max-w-52 rounded border bg-background px-1 py-1 text-xs"
                    value={signal.when.objective_id ?? ''}
                    onChange={(e) => void updateSignal(i, { when: { objective_id: e.target.value, outcome: (signal.when as { outcome: 'completed' | 'failed' }).outcome } })}
                  >
                    {objectives.map((o) => (
                      <option key={o.id} value={o.id}>{o.title}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Outcome"
                    className="rounded border bg-background px-1 py-1 text-xs"
                    value={signal.when.outcome}
                    onChange={(e) => void updateSignal(i, { when: { objective_id: (signal.when as { objective_id: string | null }).objective_id, outcome: e.target.value as 'completed' | 'failed' } })}
                  >
                    {OBJECTIVE_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </>
              )}

              {'npc_id' in signal.when && (
                <>
                  <select
                    aria-label="NPC"
                    className="max-w-52 rounded border bg-background px-1 py-1 text-xs"
                    value={signal.when.npc_id ?? ''}
                    onChange={(e) => void updateSignal(i, { when: { npc_id: e.target.value, state: (signal.when as { state: typeof NPC_STATES[number] }).state } })}
                  >
                    {npcs.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}{n.role === 'boss' ? ' (boss)' : ''}</option>
                    ))}
                  </select>
                  <select
                    aria-label="NPC state"
                    className="rounded border bg-background px-1 py-1 text-xs"
                    value={signal.when.state}
                    onChange={(e) => void updateSignal(i, { when: { npc_id: (signal.when as { npc_id: string | null }).npc_id, state: e.target.value as typeof NPC_STATES[number] } })}
                  >
                    {NPC_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </>
              )}

              {'dial' in signal.when && (() => {
                const w = signal.when
                const isLte = 'lte' in w
                const bound = (isLte ? w.lte : w.gte) ?? 3
                return (
                  <>
                    <select
                      aria-label="Dial"
                      className="max-w-40 rounded border bg-background px-1 py-1 text-xs"
                      value={w.dial}
                      onChange={(e) => void updateSignal(i, { when: isLte ? { dial: e.target.value, lte: bound } : { dial: e.target.value, gte: bound } })}
                    >
                      {dials.length === 0 && <option value="">(no dials)</option>}
                      {dials.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
                    </select>
                    <select
                      aria-label="Dial comparator"
                      className="rounded border bg-background px-1 py-1 text-xs"
                      value={isLte ? 'lte' : 'gte'}
                      onChange={(e) => void updateSignal(i, { when: e.target.value === 'lte' ? { dial: w.dial, lte: bound } : { dial: w.dial, gte: bound } })}
                    >
                      <option value="gte">&ge;</option>
                      <option value="lte">&le;</option>
                    </select>
                    <Input
                      aria-label="Dial threshold"
                      type="number"
                      min={-5}
                      max={5}
                      className="w-14"
                      defaultValue={bound}
                      onBlur={(e) => {
                        const n = Number(e.target.value)
                        if (n < -5 || n > 5) return
                        void updateSignal(i, { when: isLte ? { dial: w.dial, lte: n } : { dial: w.dial, gte: n } })
                      }}
                    />
                  </>
                )
              })()}

              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                weight
                <Input
                  aria-label="Signal weight"
                  type="number"
                  min={-5}
                  max={5}
                  className="w-16"
                  defaultValue={signal.weight}
                  onBlur={(e) => {
                    const weight = Number(e.target.value)
                    if (weight !== signal.weight && weight !== 0 && Math.abs(weight) <= 5) void updateSignal(i, { weight })
                  }}
                />
              </label>
              <Input
                aria-label="Signal note"
                className="min-w-32 flex-1 text-xs"
                placeholder="note"
                defaultValue={signal.note}
                onBlur={(e) => e.target.value !== signal.note && void updateSignal(i, { note: e.target.value })}
              />
              <button
                type="button"
                className="text-xs text-destructive hover:underline"
                onClick={() => void run(() => saveSignals(signals.filter((_, j) => j !== i)))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => void run(() => saveSignals([...signals, { when: defaultWhen('objective', objectives, npcs, dials), weight: 1, note: '' }]))}
          >
            Add signal
          </Button>
        </div>
      </section>

      {ending.pendingRegen && (
        <RegenBanner
          table="endings"
          rowId={ending.id}
          current={{
            title: ending.title,
            description: ending.description,
            climax_summary: ending.climaxSummary,
            tone: ending.tone,
            trigger_conditions: ending.triggerConditions,
          }}
          pendingRegen={ending.pendingRegen}
          onResolved={onChanged}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  )
}
