import { Button } from '@/components/ui/button'
import { DIFFICULTY_PRESETS } from '@rules/combat'
import type { CombatEngineState, DifficultySetting } from '@rules/combat'

interface CombatPanelProps {
  engine: CombatEngineState
  difficulty: DifficultySetting
  /** True once the fight is over, including boss-down-ends while the engine is still 'active'. */
  resolved?: boolean
  onDifficultyChange: (setting: DifficultySetting) => void
  onAutoResolve: () => void
  onRunToEnd: () => void
  onReset: () => void
}

/**
 * DM console (ai-assist surface). Player-facing turn UI lives on the map overlays (initiative
 * rail + action bar); this panel holds only the DM/dev levers and is never player-visible.
 */
export function CombatPanel({
  engine, difficulty, resolved, onDifficultyChange, onAutoResolve, onRunToEnd, onReset,
}: CombatPanelProps) {
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">DM console</h2>
        <span className="text-xs text-muted-foreground">
          {engine.status === 'ended' ? `${engine.winner} wins` : resolved ? 'resolved' : `Round ${engine.round}`}
        </span>
      </div>

      <label htmlFor="lab-live-difficulty" className="text-xs text-muted-foreground">
        Difficulty (applies from next roll)
      </label>
      <select
        id="lab-live-difficulty"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
        value={difficulty.name}
        onChange={(e) => {
          const preset = DIFFICULTY_PRESETS.find((d) => d.name === e.target.value)
          if (preset) onDifficultyChange(preset)
        }}
      >
        {DIFFICULTY_PRESETS.map((d) => (
          <option key={d.name} value={d.name}>{d.name}</option>
        ))}
      </select>

      {engine.status === 'active' && !resolved && (
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onAutoResolve} title="Let the heuristic play the current turn, whoever owns it">
            Auto-resolve turn
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={onRunToEnd}>
            Run to end
          </Button>
        </div>
      )}
      <Button variant="destructive" size="sm" className="w-full" onClick={onReset}>
        Back to setup
      </Button>
      <p className="text-xs text-muted-foreground">
        Select a token to edit its stats below (unredacted -- DM view).
      </p>
    </section>
  )
}
