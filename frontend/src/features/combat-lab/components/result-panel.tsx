import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { bossNpcStateForOutcome } from '@rules/combat'
import type { BossOutcome, CombatManifest, CombatResult } from '@rules/combat'

const TIER_LABEL: Record<CombatResult['tier'], string> = {
  full: 'Full success',
  partial: 'Partial (costly win)',
  failed: 'Failed (fail-forward)',
}

// Escaped is offered too (a flee-exit); the four cover the spare/capture beat (F09 SS3.6).
const BOSS_OPTIONS: { value: BossOutcome; label: string }[] = [
  { value: 'killed', label: 'Killed' },
  { value: 'spared', label: 'Spared' },
  { value: 'captured', label: 'Captured' },
  { value: 'escaped', label: 'Escaped' },
]

interface ResultPanelProps {
  result: CombatResult
  manifest: CombatManifest
  bossOutcome: BossOutcome | undefined
  onBossOutcome: (outcome: BossOutcome) => void
  onClose?: () => void
}

/**
 * The story-facing contract verifier (F09 SS11.1): shows the CombatResult the fight hands back -
 * outcome, tier, boss fate, casualties - and the beat atoms + npcState that fate implies, so a
 * spared boss producing the right ending signal can be checked WITHOUT running the story loop.
 */
export function ResultPanel({ result, manifest, bossOutcome, onBossOutcome, onClose }: ResultPanelProps) {
  const nameOf = (id: string) =>
    manifest.party.find((c) => c.id === id)?.name ?? manifest.enemies.find((c) => c.id === id)?.name ?? id
  const bossName = manifest.bossRef ? nameOf(manifest.bossRef) : null

  const atoms = result.tier === 'failed'
    ? manifest.beatSpec?.onFailure
    : result.tier === 'partial'
      ? manifest.beatSpec?.onPartial
      : manifest.beatSpec?.onSuccess
  const bossState = bossNpcStateForOutcome(result.bossOutcome)

  return (
    <section className="w-72 space-y-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Combat result</h2>
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss result" onClick={onClose}>
            ✕
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs font-semibold',
            result.outcome === 'victory' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500',
          )}
        >
          {result.outcome === 'victory' ? 'Victory' : 'Defeat'}
        </span>
        <span className="text-xs text-muted-foreground">
          tier <span className="font-medium text-foreground">{result.tier}</span> - {TIER_LABEL[result.tier]}
        </span>
      </div>

      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Party down</dt>
          <dd className="text-right">
            {result.casualties.pcIds.length === 0 ? 'none' : result.casualties.pcIds.map(nameOf).join(', ')}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Enemies dead</dt>
          <dd className="text-right">{result.casualties.npcIds.length}</dd>
        </div>
      </dl>

      {manifest.bossRef && (
        <div className="space-y-1 rounded border border-border p-2">
          <p className="text-xs font-medium">
            Boss fate{bossName ? ` - ${bossName}` : ''}
          </p>
          {result.outcome === 'victory' ? (
            <div className="flex flex-wrap gap-1">
              {BOSS_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={result.bossOutcome === opt.value ? 'default' : 'outline'}
                  size="xs"
                  onClick={() => onBossOutcome(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">The boss stands - no spare/capture choice on a defeat.</p>
          )}
          <p className="text-xs text-muted-foreground">
            {bossOutcome ? `bossOutcome: ${result.bossOutcome}` : `bossOutcome: ${result.bossOutcome} (mechanical default)`}
            {bossState ? ` -> npcState '${bossState}'` : ' -> no npcState write'}
          </p>
        </div>
      )}

      {atoms && atoms.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Story would apply</p>
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {atoms.map((atom) => (
              <li key={atom}>{atom}</li>
            ))}
          </ul>
        </div>
      )}

      {manifest.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-500">Initiator warnings</p>
          <ul className="list-inside list-disc text-xs text-amber-500/90">
            {manifest.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
