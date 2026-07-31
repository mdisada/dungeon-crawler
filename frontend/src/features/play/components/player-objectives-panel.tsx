import { cn } from '@/lib/utils'

import { usePlay } from '../hooks/use-play-context'
import { PanelSection } from './panel-section'

/**
 * Objectives, the quest journal and this character's own stake, pinned to the upper-left of the
 * window as a collapsible overlay - the player-side counterpart of DmOverviewPanel, in the same
 * corner (only one of the two ever renders). They used to sit in the sidebar header, where they
 * pushed the character sheet down the column and could not be put away.
 */
export function PlayerObjectivesPanel() {
  const { state, userId } = usePlay()
  const { list, currentId, offers, quests } = state.objectives
  const me = state.players.list.find((p) => p.userId === userId)
  const personal = me?.personal

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 w-72 max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto flex max-h-[calc(100vh-10rem)] flex-col gap-2 overflow-y-auto rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
        <PanelSection title="Objectives" count={list.length}>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">No objectives yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((objective) => (
                <li
                  key={objective.id}
                  className={cn(
                    'text-xs',
                    objective.id === currentId && 'font-semibold',
                    objective.state === 'completed' && 'text-muted-foreground line-through',
                  )}
                >
                  {objective.title}
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Quests" count={offers.length + quests.length}>
          {offers.length === 0 && quests.length === 0 ? (
            <p className="text-xs text-muted-foreground">No offers or quests yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {offers.map((offer) => (
                <li key={offer.id} className="text-xs">
                  <span className="font-medium text-amber-600 dark:text-amber-400">Awaiting your answer:</span>{' '}
                  {offer.label} ({offer.giverName}
                  {offer.gold > 0 ? `, ${offer.gold} gp` : ''})
                </li>
              ))}
              {quests.map((quest) => (
                <li key={quest.id} className="text-xs">
                  <span
                    className={cn(
                      'font-medium',
                      (quest.status === 'completed' || quest.status === 'failed') &&
                        'text-muted-foreground line-through',
                    )}
                  >
                    {quest.label}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}- {quest.giverName}
                    {quest.gold > 0 ? `, ${quest.gold} gp` : ''}
                    {quest.status === 'suspended' ? ' (paused)' : ''}
                    {quest.status === 'failed' ? ' (failed)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground" aria-label="Party gold">
            Party gold: {state.players.gold} gp
          </p>
        </PanelSection>

        {/* Your stake (2026-07-26): the personal arc bound to this character at session start.
            Reward-only by construction - it never gates the party's story. */}
        {personal?.objectiveLabel && (
          <PanelSection title="Your stake">
            <p className="text-xs">
              <span
                className={cn(
                  'font-medium',
                  personal.status === 'completed' && 'text-muted-foreground line-through',
                  personal.status === 'failed' && 'text-muted-foreground',
                )}
              >
                {personal.objectiveLabel}
              </span>
              {personal.reward && <span className="text-muted-foreground"> - {personal.reward}</span>}
            </p>
          </PanelSection>
        )}
      </div>
    </div>
  )
}
