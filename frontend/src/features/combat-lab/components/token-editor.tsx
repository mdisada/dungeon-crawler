import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CombatError, formatDiceExpr, parseDiceExpr, SPELL_LIBRARY } from '@rules/combat'
import type { AttackSpec, CombatantPatch, CombatSide, SpellSpec } from '@rules/combat'

export interface EditorTarget {
  id: string
  name: string
  phase: 'setup' | 'combat'
  hpCurrent: number | null
  hpMax: number
  hpTemp: number | null
  ac: number
  speed: number
  side: CombatSide
  attacks: AttackSpec[]
  spells: SpellSpec[]
}

function spellSummary(spell: SpellSpec): string {
  const shape = spell.area.shape === 'single' ? '' : ` ${spell.area.shape}`
  const roll =
    spell.effect === 'attack'
      ? `+${spell.toHit ?? 0} atk`
      : spell.effect === 'save'
        ? `${(spell.saveAbility ?? 'dex').toUpperCase()} DC ${spell.saveDc ?? 10}${spell.onSave === 'half' ? ' (half)' : ''}`
        : 'heal'
  return `${roll} ${formatDiceExpr(spell.amount)}${shape}`
}

interface TokenEditorProps {
  target: EditorTarget
  onPatch: (patch: CombatantPatch) => void
}

/** Commit-on-blur number field so live edits emit one engine event, not one per keystroke. */
function NumField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(String(value))
  }
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
      {label}
      <Input
        id={id}
        type="number"
        className="h-7 w-20 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = Number(draft)
          if (Number.isFinite(v) && v !== value) onCommit(v)
          else setDraft(String(value))
        }}
      />
    </label>
  )
}

function AttackRow({ attack, onChange, onRemove }: { attack: AttackSpec; onChange: (a: AttackSpec) => void; onRemove: (() => void) | null }) {
  const [damageText, setDamageText] = useState(formatDiceExpr(attack.damage))
  const [damageError, setDamageError] = useState(false)

  function commitDamage() {
    try {
      onChange({ ...attack, damage: parseDiceExpr(damageText) })
      setDamageError(false)
    } catch (e) {
      if (e instanceof CombatError) setDamageError(true)
      else throw e
    }
  }

  return (
    <li className="space-y-1 rounded border border-border/60 p-1.5">
      <div className="flex items-center gap-1">
        <Input
          aria-label="Attack name"
          className="h-7 min-w-0 flex-1"
          value={attack.name}
          onChange={(e) => onChange({ ...attack, name: e.target.value })}
        />
        <select
          aria-label="Attack kind"
          className="h-7 rounded-lg border border-input bg-background px-1 text-xs"
          value={attack.kind}
          onChange={(e) => onChange({ ...attack, kind: e.target.value as AttackSpec['kind'] })}
        >
          <option value="melee">melee</option>
          <option value="ranged">ranged</option>
        </select>
        {onRemove && (
          <Button variant="ghost" size="xs" aria-label={`Remove ${attack.name}`} onClick={onRemove}>✕</Button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          hit
          <Input
            aria-label="To-hit bonus"
            type="number"
            className="h-7 w-14"
            value={attack.toHit}
            onChange={(e) => onChange({ ...attack, toHit: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="flex items-center gap-1">
          dmg
          <Input
            aria-label="Damage dice"
            className={`h-7 w-20 ${damageError ? 'border-destructive' : ''}`}
            value={damageText}
            onChange={(e) => setDamageText(e.target.value)}
            onBlur={commitDamage}
          />
        </label>
        <label className="flex items-center gap-1">
          rng
          <Input
            aria-label="Range in squares"
            type="number"
            className="h-7 w-14"
            value={attack.range}
            onChange={(e) => onChange({ ...attack, range: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      </div>
    </li>
  )
}

export function TokenEditor({ target, onPatch }: TokenEditorProps) {
  const setAttack = (index: number, attack: AttackSpec) =>
    onPatch({ attacks: target.attacks.map((a, i) => (i === index ? attack : a)) })

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Edit: {target.name}</h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {target.phase === 'combat' && target.hpCurrent !== null && (
          <NumField id="ed-hp" label="HP" value={target.hpCurrent} onCommit={(v) => onPatch({ hpCurrent: v })} />
        )}
        <NumField id="ed-hpmax" label="HP max" value={target.hpMax} onCommit={(v) => onPatch({ hpMax: v })} />
        {target.phase === 'combat' && target.hpTemp !== null && (
          <NumField id="ed-temp" label="Temp HP" value={target.hpTemp} onCommit={(v) => onPatch({ hpTemp: v })} />
        )}
        <NumField id="ed-ac" label="AC" value={target.ac} onCommit={(v) => onPatch({ ac: v })} />
        <NumField id="ed-speed" label="Speed (sq)" value={target.speed} onCommit={(v) => onPatch({ speed: v })} />
        <label htmlFor="ed-side" className="flex items-center justify-between gap-2 text-xs">
          Side
          <select
            id="ed-side"
            className="h-7 w-20 rounded-lg border border-input bg-background px-1 text-xs"
            value={target.side}
            onChange={(e) => onPatch({ side: e.target.value as CombatSide })}
          >
            <option value="party">party</option>
            <option value="enemy">enemy</option>
          </select>
        </label>
      </div>
      <ul className="space-y-1">
        {target.attacks.map((attack, i) => (
          <AttackRow
            key={`${target.id}-${i}`}
            attack={attack}
            onChange={(a) => setAttack(i, a)}
            onRemove={target.attacks.length > 1 ? () => onPatch({ attacks: target.attacks.filter((_, x) => x !== i) }) : null}
          />
        ))}
      </ul>
      <Button
        variant="outline"
        size="xs"
        onClick={() =>
          onPatch({
            attacks: [...target.attacks, { name: 'New attack', kind: 'melee', toHit: 3, damage: { count: 1, sides: 6, bonus: 1 }, range: 1 }],
          })
        }
      >
        + Attack
      </Button>

      <div className="border-t border-border pt-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Spells</h3>
        {target.spells.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {target.spells.map((spell, i) => (
              <li key={`${spell.name}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{spell.name}</span>{' '}
                  <span className="text-muted-foreground">{spellSummary(spell)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove ${spell.name}`}
                  onClick={() => onPatch({ spells: target.spells.filter((_, x) => x !== i) })}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs italic text-muted-foreground">No spells assigned.</p>
        )}
        <select
          aria-label="Add a spell"
          className="mt-1 h-7 w-full rounded-lg border border-input bg-background px-1 text-xs"
          value=""
          onChange={(e) => {
            const spell = SPELL_LIBRARY.find((s) => s.name === e.target.value)
            if (spell) onPatch({ spells: [...target.spells, spell] })
          }}
        >
          <option value="">+ Add spell from library…</option>
          {SPELL_LIBRARY.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({spellSummary(s)})
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
