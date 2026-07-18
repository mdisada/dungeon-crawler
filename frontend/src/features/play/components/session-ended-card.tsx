import { Button } from '@/components/ui/button'

import type { SessionEndedCard as CardData } from '../types'

const SECTION_LABELS: Record<string, string> = {
  events: 'What happened',
  npc_changes: 'NPCs',
  promises: 'Promises made',
  items: 'Items gained',
  objective_progress: 'Objectives',
}

/** F05 SS4.3 end-of-session card: summary, XP gained, cost (creator only, when provided). */
export function SessionEndedCard({ card, onDismiss }: { card: CardData; onDismiss: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-label="Session summary" className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Session {card.index} complete</h2>

        <div className="mt-3 flex flex-col gap-3 text-sm">
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const entries = card.summary[key] ?? []
            if (entries.length === 0) return null
            return (
              <section key={key}>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</h3>
                <ul className="list-inside list-disc">
                  {entries.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </section>
            )
          })}
          <p className="text-muted-foreground">XP gained: {card.xpGained}</p>
          {card.costUsd !== null && (
            <p className="text-muted-foreground">Cost this session: ${card.costUsd.toFixed(3)}</p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={onDismiss}>Back to lobby</Button>
        </div>
      </div>
    </div>
  )
}
