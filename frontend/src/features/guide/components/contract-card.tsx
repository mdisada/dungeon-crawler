import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { saveGuideRow } from '../api/save-guide-row'
import type { GuideContract, Npc, Objective } from '../types'

interface ContractCardProps {
  contract: GuideContract
  npcs: Npc[]
  objectives: Objective[]
  onChanged: () => void
}

/**
 * Quest contract editor row (F04 SS4.3): the authored offer behind F08's reactive-story gate.
 * Giver picker, label/stakes inline edit, reward floor/ceiling (the live haggling bounds),
 * covered-objective chips. Row-level autosave like every other guide table.
 */
export function ContractCard({ contract, npcs, objectives, onChanged }: ContractCardProps) {
  const giverId = useId()
  const [draft, setDraft] = useState({
    label: contract.label,
    stakes: contract.stakes,
    floor: String(contract.reward.gold_floor ?? 0),
    ceiling: String(contract.reward.gold_ceiling ?? 0),
  })
  const [error, setError] = useState<string | null>(null)

  function save(patch: Record<string, unknown>) {
    saveGuideRow('quest_contracts', contract.id, patch)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  function saveReward() {
    const floor = Math.max(0, Number(draft.floor) || 0)
    const ceiling = Math.max(floor, Number(draft.ceiling) || 0)
    setDraft((d) => ({ ...d, floor: String(floor), ceiling: String(ceiling) }))
    save({ reward: { ...contract.reward, gold_floor: floor, gold_ceiling: ceiling } })
  }

  const objectiveTitles = contract.objectiveIds
    .map((id) => objectives.find((o) => o.id === id)?.title)
    .filter((t): t is string => Boolean(t))

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {contract.isEntry && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
            Entry offer
          </span>
        )}
        <Input
          className="min-w-48 flex-1 text-sm font-medium"
          aria-label="Quest label"
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          onBlur={() => draft.label !== contract.label && save({ label: draft.label })}
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={giverId}>
          Giver
          <select
            id={giverId}
            className="h-9 rounded-md border bg-transparent px-2 text-sm text-foreground"
            value={contract.giverNpcId}
            onChange={(e) => save({ giver_npc_id: e.target.value })}
          >
            {npcs.map((npc) => (
              <option key={npc.id} value={npc.id}>
                {npc.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Gold floor (opening bid)
          <Input
            type="number"
            min={0}
            className="text-sm"
            value={draft.floor}
            onChange={(e) => setDraft((d) => ({ ...d, floor: e.target.value }))}
            onBlur={saveReward}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Gold ceiling (haggle limit)
          <Input
            type="number"
            min={0}
            className="text-sm"
            value={draft.ceiling}
            onChange={(e) => setDraft((d) => ({ ...d, ceiling: e.target.value }))}
            onBlur={saveReward}
          />
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
        Stakes (why it matters to the giver - player-facing)
        <Textarea
          className="min-h-16 text-sm text-foreground"
          value={draft.stakes}
          onChange={(e) => setDraft((d) => ({ ...d, stakes: e.target.value }))}
          onBlur={() => draft.stakes !== contract.stakes && save({ stakes: draft.stakes })}
        />
      </label>
      {objectiveTitles.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {objectiveTitles.map((title) => (
            <span key={title} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {title}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
