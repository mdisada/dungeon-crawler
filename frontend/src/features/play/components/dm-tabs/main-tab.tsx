import { usePlay } from '../../hooks/use-play-context'
import { AutoToggles } from './auto-toggles'
import { DmCombatTab } from './combat-tab'
import { NarrationSection } from './narration-section'
import { ReviewPanel } from './review-panel'
import { RoleplaySection } from './roleplay-section'

/**
 * DM Main tab: a context-adaptive section that follows scene.mode - combat status in battle,
 * the reply console in roleplay (Slice 2), narration controls otherwise. Objectives + players
 * live in the DmOverviewPanel pinned to the upper-left of the window.
 */
export function DmMainTab() {
  const { state } = usePlay()

  const inCombat = (state.scene.mode === 'battle' || state.scene.mode === 'puzzle') && state.combat !== null

  return (
    <div className="flex flex-col gap-4 text-sm">
      <AutoToggles />

      <hr className="border-border" />

      <ReviewPanel />

      {inCombat ? (
        <DmCombatTab combat={state.combat!} />
      ) : state.scene.mode === 'roleplay' ? (
        <RoleplaySection />
      ) : (
        <NarrationSection />
      )}
    </div>
  )
}
