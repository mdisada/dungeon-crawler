import { Button } from '@/components/ui/button'

import type { CombatEncounterOption } from '../api/encounters'
import type { AdventureGroup } from '../hooks/use-encounter-replay'

interface EncounterPickerProps {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  adventures: AdventureGroup[]
  adventureId: string
  onAdventureChange: (id: string) => void
  encounters: CombatEncounterOption[]
  encounterId: string
  onEncounterChange: (id: string) => void
  selectedEncounter: CombatEncounterOption | null
  contextStatus: 'idle' | 'loading' | 'ready' | 'error'
  hasBoss: boolean
  bossName: string | null
  includeBoss: boolean
  onIncludeBoss: (value: boolean) => void
  partyCount: number
  replayActive: boolean
  onLoad: () => void
  onClear: () => void
}

const enemyLabel = (enc: CombatEncounterOption) =>
  enc.enemies.map((e) => (e.count > 1 ? `${e.count}x ${e.name}` : e.name)).join(', ')

/**
 * Story-encounter replay picker (F09 SS11.1): pick a real adventure -> one of its authored combat
 * encounters -> load it through the SHARED initiator so the Lab builds the exact manifest live play
 * would. The manual roster below still works for hand-built fights; this path is additive.
 */
export function EncounterPicker({
  status, error, adventures, adventureId, onAdventureChange, encounters, encounterId, onEncounterChange,
  selectedEncounter, contextStatus, hasBoss, bossName, includeBoss, onIncludeBoss, partyCount,
  replayActive, onLoad, onClear,
}: EncounterPickerProps) {
  const enemyCount = selectedEncounter?.enemies.reduce((sum, e) => sum + e.count, 0) ?? 0
  const canLoad = !!selectedEncounter && contextStatus === 'ready' && partyCount > 0

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">Story encounter (replay)</h2>
      <p className="text-xs text-muted-foreground">
        Rebuild a real adventure's fight through the shared combat initiator, then simulate it.
      </p>
      {status === 'loading' && <p className="text-xs text-muted-foreground">Loading your combat encounters…</p>}
      {status === 'error' && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {status === 'ready' && adventures.length === 0 && (
        <p className="text-xs text-muted-foreground">No authored combat encounters found in your adventures.</p>
      )}

      {adventures.length > 0 && (
        <>
          <select
            aria-label="Adventure"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            value={adventureId}
            onChange={(e) => onAdventureChange(e.target.value)}
          >
            <option value="">Adventure…</option>
            {adventures.map((a) => (
              <option key={a.id} value={a.id}>{a.title} ({a.count})</option>
            ))}
          </select>

          {adventureId && (
            <select
              aria-label="Combat encounter"
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
              value={encounterId}
              onChange={(e) => onEncounterChange(e.target.value)}
            >
              <option value="">Combat encounter…</option>
              {encounters.map((enc) => (
                <option key={enc.id} value={enc.id}>{enemyLabel(enc)}</option>
              ))}
            </select>
          )}

          {selectedEncounter && (
            <div className="space-y-2 rounded border border-border p-2 text-xs">
              {selectedEncounter.summary && <p className="text-muted-foreground">{selectedEncounter.summary}</p>}
              <p>
                <span className="font-medium">{enemyCount}</span> enemies vs{' '}
                <span className="font-medium">{partyCount}</span> {partyCount === 1 ? 'character' : 'characters'}
              </p>
              {hasBoss && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeBoss} onChange={(e) => onIncludeBoss(e.target.checked)} />
                  <span>Boss fight{bossName ? ` (${bossName})` : ''}</span>
                </label>
              )}
              {contextStatus === 'loading' && <p className="text-muted-foreground">Loading party and NPCs…</p>}
              {contextStatus === 'ready' && partyCount === 0 && (
                <p className="text-amber-500">Complete a character first - the party has no one to deploy.</p>
              )}
              {contextStatus === 'error' && <p className="text-destructive">Failed to load this adventure's combat data.</p>}
            </div>
          )}

          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="flex-1" disabled={!canLoad} onClick={onLoad}>
              Load encounter
            </Button>
            {replayActive && (
              <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
