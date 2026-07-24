import { Bug, BookOpen, Dices, ScrollText, Swords } from 'lucide-react'
import { useState } from 'react'

import { Tabs, TabsList, TabsPanel } from '@/components/ui/tabs'
import { useSession } from '@/features/auth'
import { cn } from '@/lib/utils'

import { isDebugUser } from '../debug'
import { useCharacterSheet } from '../hooks/use-character-sheet'
import type { CharacterSheet } from '../hooks/use-character-sheet'
import { useIntents } from '../hooks/use-intents'
import { usePlay } from '../hooks/use-play-context'
import { DebugTab } from './debug-tab'
import { SidebarIconTab } from './sidebar-icon-tab'
import { StoryLogTab } from './story-log-tab'

/**
 * F06 SS4: objective header, tabbed sheet (Ability & Skills / Combat / Background), persistent
 * character strip. Combat tab auto-becomes primary when scene.mode='battle'; a manual pick is
 * respected until the mode changes again.
 */
export function PlayerSidebar() {
  const { state, userId } = usePlay()
  const { user } = useSession()
  const showDebug = isDebugUser(user?.email)
  const me = state.players.list.find((p) => p.userId === userId)
  const sheetState = useCharacterSheet(me?.characterId ?? null)
  const isBattle = state.scene.mode === 'battle'
  // Auto-switch on mode change only - a manual pick sticks until the next transition (F06 SS4).
  // Render-time adjustment (not an effect) per the react.dev "adjusting state" pattern.
  const [tabState, setTabState] = useState({ isBattle, tab: isBattle ? 'combat' : 'skills' })
  if (tabState.isBattle !== isBattle) {
    setTabState({ isBattle, tab: isBattle ? 'combat' : 'skills' })
  }
  const tab = tabState.tab
  const setTab = (next: string) => setTabState({ isBattle, tab: next })

  const currentObjective = state.objectives.list.find((o) => o.id === state.objectives.currentId)
  const { offers, quests } = state.objectives

  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current objective</p>
          <p className="shrink-0 text-xs font-medium tabular-nums" aria-label="Party gold">
            {state.players.gold} gp
          </p>
        </div>
        <p className="text-sm font-medium">{currentObjective?.title ?? 'None yet'}</p>
        {/* Minimal quest journal (F08 SS2.2): accepted terms stay visible at a glance. */}
        {quests.length > 0 && (
          <div className="mt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Quests</p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {quests.map((quest) => (
                <li key={quest.id} className="text-xs">
                  <span className={cn('font-medium', quest.status === 'completed' && 'text-muted-foreground line-through')}>
                    {quest.label}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}- {quest.giverName}
                    {quest.gold > 0 ? `, ${quest.gold} gp` : ''}
                    {quest.status === 'suspended' ? ' (paused)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {offers.length > 0 && (
          <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            Awaiting your answer: {offers.map((o) => o.label).join('; ')}
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {sheetState.status === 'loading' && <p className="p-3 text-sm text-muted-foreground">Loading sheet…</p>}
        {sheetState.status === 'error' && <p className="p-3 text-sm text-muted-foreground">{sheetState.message}</p>}
        {sheetState.status === 'ready' && (
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b p-3">
              <TabsList>
                <SidebarIconTab value="skills" label="Ability & Skills" icon={Dices} />
                <SidebarIconTab value="combat" label="Combat" icon={Swords} />
                <SidebarIconTab value="background" label="Background" icon={ScrollText} />
                <SidebarIconTab value="log" label="Story log" icon={BookOpen} />
                {showDebug && <SidebarIconTab value="debug" label="Debug" icon={Bug} />}
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <TabsPanel value="skills" className="mt-0">
                <SkillsTab sheet={sheetState.sheet} />
              </TabsPanel>
              <TabsPanel value="combat" className="mt-0">
                <CombatTab sheet={sheetState.sheet} hp={me?.hp ?? null} />
              </TabsPanel>
              <TabsPanel value="background" className="mt-0">
                <BackgroundTab sheet={sheetState.sheet} />
              </TabsPanel>
              <TabsPanel value="log" className="mt-0">
                <StoryLogTab />
              </TabsPanel>
              {showDebug && (
                <TabsPanel value="debug" className="mt-0">
                  <DebugTab />
                </TabsPanel>
              )}
            </div>
          </Tabs>
        )}
      </div>

      {sheetState.status === 'ready' && me && (
        <footer className="flex items-center gap-3 border-t p-3">
          {sheetState.sheet.imageUrl ? (
            <img src={sheetState.sheet.imageUrl} alt={sheetState.sheet.name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-semibold">
              {sheetState.sheet.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{sheetState.sheet.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {sheetState.sheet.className} {sheetState.sheet.level} · {sheetState.sheet.raceName}
              {sheetState.sheet.alignment ? ` · ${sheetState.sheet.alignment}` : ''} · {sheetState.sheet.xp} XP
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded bg-muted" role="meter" aria-label="Hit points" aria-valuemin={0} aria-valuemax={me.hp.max} aria-valuenow={me.hp.current}>
              <div
                className={cn('h-full rounded bg-emerald-500', me.hp.current / Math.max(1, me.hp.max) < 0.34 && 'bg-red-500')}
                style={{ width: `${Math.min(100, (me.hp.current / Math.max(1, me.hp.max)) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {me.hp.current}/{me.hp.max} HP{me.hp.temp > 0 ? ` (+${me.hp.temp} temp)` : ''}
            </p>
          </div>
        </footer>
      )}
    </div>
  )
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

function SkillsTab({ sheet }: { sheet: CharacterSheet }) {
  const { state, isSpectator } = usePlay()
  const { isBusy, roll } = useIntents()
  const canRoll =
    !isSpectator && state.session.status === 'active' && !state.dialogue.pending && !state.dialogue.typing

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-3 gap-2">
        {sheet.saves.map((save) => (
          <div key={save.key} className="rounded border p-2 text-center">
            <p className="text-xs uppercase text-muted-foreground">{save.key}</p>
            <p className="font-semibold">{sheet.abilities[save.key]}</p>
            <p className="text-xs">{fmt(sheet.modifiers[save.key])}</p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Saving throws</h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
          {sheet.saves.map((save) => (
            <li key={save.key} className="flex justify-between">
              <span className={cn('uppercase', save.proficient && 'font-semibold')}>{save.key}</span>
              <span>{fmt(save.modifier)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Skills</h3>
        <ul className="flex flex-col gap-1">
          {sheet.skills.map((skill) => (
            <li key={skill.name}>
              {/* Tap-to-roll: fast-path roll intent (F07 SS3.2) - server rolls and posts the line. */}
              <button
                type="button"
                className="flex w-full justify-between rounded px-1 py-0.5 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                disabled={!canRoll || isBusy}
                aria-label={`Roll ${skill.name.replaceAll('-', ' ')}`}
                onClick={() => void roll(skill.name.replaceAll('-', ' '))}
              >
                <span className={cn('capitalize', skill.proficient && 'font-semibold')}>{skill.name.replaceAll('-', ' ')}</span>
                <span>{fmt(skill.modifier)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CombatTab({ sheet, hp }: { sheet: CharacterSheet; hp: { current: number; max: number; temp: number } | null }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border p-2">
          <p className="text-xs text-muted-foreground">Speed</p>
          <p className="font-semibold">{sheet.speed ?? '30 ft.'}</p>
        </div>
        <div className="rounded border p-2">
          <p className="text-xs text-muted-foreground">Initiative</p>
          <p className="font-semibold">{fmt(sheet.initiativeMod)}</p>
        </div>
        <div className="rounded border p-2">
          <p className="text-xs text-muted-foreground">HP</p>
          <p className="font-semibold">{hp ? `${hp.current}/${hp.max}` : '—'}</p>
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Equipment</h3>
        {sheet.equipment.length > 0 ? (
          <ul className="list-inside list-disc">
            {sheet.equipment.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No equipment recorded.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Attacks &amp; spellcasting detail arrives with the combat engine (Phase 7).
        </p>
      </div>
    </div>
  )
}

function BackgroundTab({ sheet }: { sheet: CharacterSheet }) {
  const entries = Object.entries(sheet.personality).filter(([, v]) => v)
  return (
    <div className="flex flex-col gap-4 text-sm">
      {entries.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Personality</h3>
          {entries.map(([key, value]) => (
            <p key={key} className="mb-1">
              <span className="font-medium capitalize">{key.replaceAll('_', ' ')}: </span>
              {value}
            </p>
          ))}
        </div>
      )}
      {sheet.freeformText && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Backstory</h3>
          <p className="whitespace-pre-wrap leading-relaxed">{sheet.freeformText}</p>
        </div>
      )}
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Proficiencies</h3>
        <p className="capitalize">{sheet.proficiencies.join(', ') || 'None recorded.'}</p>
      </div>
    </div>
  )
}
