import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DIFFICULTY_PRESETS } from '@rules/combat'
import type { DifficultySetting } from '@rules/combat'

interface SimControlsProps {
  seed: number
  stepMode: boolean
  difficulty: DifficultySetting
  gridOn: boolean
  partyCount: number
  enemyCount: number
  /** Null = ready to start; otherwise the specific reason initiative can't roll. */
  startBlocker: string | null
  /** Surfaced from a thrown createCombat (e.g. two tokens sharing a square). */
  error: string | null
  onSeedChange: (seed: number) => void
  onStepChange: (on: boolean) => void
  onDifficultyChange: (setting: DifficultySetting) => void
  onStart: () => void
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'text-emerald-500' : 'text-muted-foreground'}>
      {ok ? '✓' : '○'} {children}
    </li>
  )
}

export function SimControls({
  seed, stepMode, difficulty, gridOn, partyCount, enemyCount, startBlocker, error,
  onSeedChange, onStepChange, onDifficultyChange, onStart,
}: SimControlsProps) {
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Simulation</h2>
      <Label htmlFor="lab-seed" className="text-xs">RNG seed</Label>
      <div className="flex gap-1">
        <Input
          id="lab-seed"
          type="number"
          value={seed}
          onChange={(e) => onSeedChange(Number(e.target.value) || 0)}
          className="h-8"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSeedChange(Math.floor(Math.random() * 1_000_000_000))}
        >
          Reroll
        </Button>
      </div>
      <Label htmlFor="lab-difficulty" className="text-xs">Difficulty</Label>
      <select
        id="lab-difficulty"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={difficulty.name}
        onChange={(e) => {
          const preset = DIFFICULTY_PRESETS.find((d) => d.name === e.target.value)
          if (preset) onDifficultyChange(preset)
        }}
      >
        {DIFFICULTY_PRESETS.map((d) => (
          <option key={d.name} value={d.name}>
            {d.name} (HPx{d.hpMult}, hit{d.toHit >= 0 ? `+${d.toHit}` : d.toHit}, dmgx{d.dmgMult})
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={stepMode} onChange={(e) => onStepChange(e.target.checked)} />
        Step through rolls
      </label>
      <ul className="rounded border border-border/60 p-2 text-xs">
        <Check ok={gridOn}>Grid on</Check>
        <Check ok={partyCount > 0}>Party added ({partyCount}) &mdash; add below with &ldquo;+ Party&rdquo;</Check>
        <Check ok={enemyCount > 0}>Enemies added ({enemyCount}) &mdash; add below with &ldquo;+ Enemy&rdquo;</Check>
      </ul>
      <Button className="w-full" onClick={onStart} disabled={startBlocker !== null}>
        Roll initiative
      </Button>
      {startBlocker && <p className="text-xs text-muted-foreground">{startBlocker}</p>}
      {error && (
        <p role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
