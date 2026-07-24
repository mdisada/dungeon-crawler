import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { findSpell, MONSTER_FIXTURES } from '@rules/combat'
import type { CombatSide, SaveModifiers, SpellSpec } from '@rules/combat'

import type { LabStats, LabToken, RosterCharacter, RosterNpc } from '../types'

interface RosterPanelProps {
  characters: RosterCharacter[]
  npcs: RosterNpc[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  tokens: LabToken[]
  selectedId: string | null
  onAdd: (partial: { name: string; kind: 'pc' | 'npc'; refId: string | null; side: CombatSide; stats: LabStats; auto: boolean }) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onToggleAuto: (id: string, auto: boolean) => void
  onAutoPlace: () => void
}

export function RosterPanel({
  characters, npcs, status, error, tokens, selectedId,
  onAdd, onSelect, onRemove, onToggleAuto, onAutoPlace,
}: RosterPanelProps) {
  const [characterId, setCharacterId] = useState('')
  const [npcId, setNpcId] = useState('')
  const [monsterKey, setMonsterKey] = useState(MONSTER_FIXTURES[0].key)

  function addCharacter() {
    const c = characters.find((x) => x.id === characterId)
    if (c) onAdd({ name: c.name, kind: 'pc', refId: c.id, side: 'party', stats: c.stats, auto: false })
  }

  function addNpc(side: CombatSide) {
    const n = npcs.find((x) => x.id === npcId)
    if (n) onAdd({ name: n.name, kind: 'npc', refId: n.id, side, stats: n.stats, auto: true })
  }

  function addMonster(side: CombatSide) {
    const m = MONSTER_FIXTURES.find((x) => x.key === monsterKey)
    if (!m) return
    const spells = (m.spellNames ?? []).map(findSpell).filter((s): s is SpellSpec => !!s)
    const saves: SaveModifiers = {
      str: 0, dex: m.dexMod, con: 0, int: 0, wis: 0, cha: 0, ...m.saves,
    }
    onAdd({
      name: m.name, kind: 'npc', refId: m.key, side, auto: true,
      stats: { hpMax: m.hpMax, ac: m.ac, speed: m.speed, dexMod: m.dexMod, saves, attacks: m.attacks, spells },
    })
  }

  const sidePair = (onPick: (side: CombatSide) => void, disabled: boolean) => (
    <div className="flex gap-1">
      <Button variant="outline" size="xs" disabled={disabled} onClick={() => onPick('party')}>+ Party</Button>
      <Button variant="outline" size="xs" disabled={disabled} onClick={() => onPick('enemy')}>+ Enemy</Button>
    </div>
  )

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Combatants</h2>
      <p className="text-xs text-muted-foreground">
        Pick from a dropdown, then click <span className="font-medium">+ Party</span> or{' '}
        <span className="font-medium">+ Enemy</span> to place them.
      </p>
      {status === 'loading' && <p className="text-xs text-muted-foreground">Loading your characters and NPCs…</p>}
      {status === 'error' && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-1">
        <select
          aria-label="Character to add"
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
        >
          <option value="">Character…</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name} (lv {c.level})</option>
          ))}
        </select>
        <Button variant="outline" size="xs" disabled={!characterId} onClick={addCharacter}>+ Party</Button>
      </div>

      <div className="flex items-center gap-1">
        <select
          aria-label="Adventure NPC to add"
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
          value={npcId}
          onChange={(e) => setNpcId(e.target.value)}
        >
          <option value="">Adventure NPC…</option>
          {npcs.map((n) => (
            <option key={n.id} value={n.id}>{n.name} ({n.adventureTitle})</option>
          ))}
        </select>
        {sidePair(addNpc, !npcId)}
      </div>

      <div className="flex items-center gap-1">
        <select
          aria-label="Monster to add"
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
          value={monsterKey}
          onChange={(e) => setMonsterKey(e.target.value)}
        >
          {MONSTER_FIXTURES.map((m) => (
            <option key={m.key} value={m.key}>{m.name} (AC {m.ac}, {m.hpMax} HP)</option>
          ))}
        </select>
        {sidePair(addMonster, false)}
      </div>

      {tokens.length > 0 && (
        <>
          <ul className="space-y-1">
            {tokens.map((t) => (
              <li
                key={t.id}
                className={cn(
                  'flex items-center gap-2 rounded border border-transparent px-1 py-0.5 text-sm',
                  t.id === selectedId && 'border-amber-300',
                )}
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 shrink-0 rounded-full', t.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')}
                />
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onSelect(t.id)}>
                  {t.name}
                </button>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={t.auto} onChange={(e) => onToggleAuto(t.id, e.target.checked)} />
                  auto
                </label>
                <Button variant="ghost" size="xs" aria-label={`Remove ${t.name}`} onClick={() => onRemove(t.id)}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="w-full" onClick={onAutoPlace}>
            Auto-place (party left, enemies right)
          </Button>
        </>
      )}
    </section>
  )
}
