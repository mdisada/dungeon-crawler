import { useState } from 'react'

import { deriveNpcStatBlock, NPC_ARCHETYPES, NPC_CR_LADDER, type NpcStatBlock } from '@rules/guide'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveGuideRow } from '../api/save-guide-row'
import type { Npc } from '../types'

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

function fmt(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`
}

// Reconstruct the derive seed from a stored block so an edit re-derives from the same inputs.
function toSeed(block: NpcStatBlock) {
  return {
    cr: block.cr,
    archetype: block.archetype,
    skills: block.skillProficiencies,
    attack: block.attack.name,
  }
}

export function NpcStatBlockPanel({ npc, onChanged }: { npc: Npc; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)

  function persist(block: NpcStatBlock) {
    saveGuideRow('npcs', npc.id, { stat_block: block })
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  if (!npc.statBlock) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <p className="text-xs text-muted-foreground">No combat stat block yet.</p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => persist(deriveNpcStatBlock({}, npc.role))}
        >
          Generate stat block
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  const block = npc.statBlock
  const seed = toSeed(block)

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Challenge rating
          <select
            aria-label="Challenge rating"
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            value={block.cr}
            onChange={(e) => persist(deriveNpcStatBlock({ ...seed, cr: e.target.value }, npc.role))}
          >
            {NPC_CR_LADDER.map((cr) => (
              <option key={cr} value={cr}>
                CR {cr}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Archetype
          <select
            aria-label="Combat archetype"
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            value={block.archetype}
            onChange={(e) => persist(deriveNpcStatBlock({ ...seed, archetype: e.target.value }, npc.role))}
          >
            {NPC_ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted-foreground">Defense</span>
          <span className="text-sm text-foreground">
            HP {block.hpMax} &middot; AC {block.ac} &middot; PB {fmt(block.proficiencyBonus)} &middot; Speed {block.speed}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1 text-center">
        {ABILITY_ORDER.map((key) => (
          <div key={key} className="rounded-md border py-1">
            <div className="text-xs uppercase text-muted-foreground">{key}</div>
            <div className="text-sm font-medium text-foreground">{block.abilities[key]}</div>
            <div className="text-xs text-muted-foreground">{fmt(block.abilityModifiers[key])}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Saves: {block.savingThrowProficiencies.map((s) => s.toUpperCase()).join(', ') || 'none'}
        </span>
        <span className="text-muted-foreground">
          Skills:{' '}
          {block.skillProficiencies.length > 0
            ? block.skillProficiencies.map((s) => `${s} ${fmt(block.skillModifiers[s] ?? 0)}`).join(', ')
            : 'none'}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Signature attack
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs text-sm text-foreground"
            defaultValue={block.attack.name}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== block.attack.name) persist(deriveNpcStatBlock({ ...seed, attack: name }, npc.role))
            }}
          />
          <span className="text-sm text-foreground">
            {fmt(block.attack.toHit)} to hit &middot; {block.attack.damage} damage
          </span>
        </div>
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
