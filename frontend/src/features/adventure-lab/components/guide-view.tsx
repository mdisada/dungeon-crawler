import type { ReactNode } from 'react'

import type { GuideView } from '../types'

const OBJ_STATE: Record<string, string> = {
  hidden: 'bg-muted text-muted-foreground',
  revealed: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  active: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
}
const NPC_STATE: Record<string, string> = {
  alive: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  absent: 'bg-muted text-muted-foreground',
  dead: 'bg-destructive/15 text-destructive',
}
const badge = (cls: string): string => `shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${cls}`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** The Adventure Guide tab: authored content + live overlay, so unreached content is obvious. */
export function GuideOverlay({ guide }: { guide: GuideView }) {
  const leading = (status: string) => status === 'leading' || status === 'committed'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Objectives {guide.counts.objectivesDone}/{guide.counts.objectivesTotal} done · Clues {guide.counts.cluesFound}/{guide.counts.cluesTotal} found
          {guide.counts.nodesTotal > 0 && ` · Scenes ${guide.counts.nodesPlayed}/${guide.counts.nodesTotal} played`}
        </p>

        {/* The authored story graph. Unplayed nodes are the whole point of showing it: they are
            the routes the party did not take, and a rescue node that got played is an anomaly. */}
        {guide.nodes.length > 0 && (
          <Section title="Story graph (authored scenes)">
            <ul className="flex flex-col gap-2">
              {guide.nodes.map((node) => (
                <li key={node.key} className="rounded border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 font-medium">{node.label || node.key}</span>
                    {node.role === 'rescue' && (
                      <span className={badge('bg-amber-500/15 text-amber-600 dark:text-amber-400')}>rescue</span>
                    )}
                    <span className={badge('bg-muted text-muted-foreground')}>{node.kind.replace('_', ' ')}</span>
                    <span
                      className={badge(node.played
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground')}
                    >
                      {node.played ? 'played' : 'unplayed'}
                    </span>
                  </div>
                  {node.choices.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Choices: {node.choices.join(' · ')}</p>
                  )}
                  {node.exits.length > 0 && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{node.exits.join('   ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {guide.personalSlots.length > 0 && (
          <Section title="Personal stakes (slots)">
            <ul className="flex flex-col gap-1">
              {guide.personalSlots.map((slot) => (
                <li key={slot.key} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{slot.label}</span>
                  <span className={badge('bg-muted text-muted-foreground')}>{slot.key}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Objectives (the spine)">
          <ol className="flex flex-col gap-1">
            {guide.objectives.map((o) => (
              <li key={o.index} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-right text-muted-foreground">{o.index + 1}.</span>
                <span className="min-w-0 flex-1">{o.title}</span>
                <span className={badge(OBJ_STATE[o.state] ?? 'bg-muted')}>{o.state}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Cast">
          <ul className="flex flex-col gap-1">
            {guide.npcs.map((npc, i) => (
              <li key={`${npc.name}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {npc.name}
                  {npc.role === 'boss' && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(boss)</span>}
                </span>
                <span className={badge(NPC_STATE[npc.state] ?? 'bg-muted')}>{npc.state}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Clues">
          {guide.clues.length === 0 && <p className="text-sm text-muted-foreground">none authored</p>}
          <ul className="flex flex-col gap-1">
            {guide.clues.map((clue, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0" aria-hidden>{clue.discovered ? '✅' : '⬜'}</span>
                <span className={`min-w-0 flex-1 ${clue.discovered ? '' : 'text-muted-foreground'}`}>{clue.text}</span>
                <span className={badge('bg-muted text-muted-foreground')}>{clue.type}</span>
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-5 sm:grid-cols-2">
          <Section title="Locations">
            <ul className="flex flex-col gap-1 text-sm">
              {guide.locations.map((loc, i) => (
                <li key={i} className={loc.current ? 'font-semibold' : ''}>
                  {loc.name}
                  {loc.current && <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">← here</span>}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Endings">
            <ul className="flex flex-col gap-1 text-sm">
              {guide.endings.map((ending, i) => (
                <li key={i} className={leading(ending.status) ? 'font-semibold' : 'text-muted-foreground'}>
                  {ending.title} <span className="text-xs">({ending.tone})</span>
                  {leading(ending.status) && <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">{ending.status}</span>}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section title="Encounters">
          <ul className="flex flex-wrap gap-2 text-sm">
            {guide.encounters.map((enc, i) => (
              <li key={i} className="rounded border px-2 py-0.5">
                <span className="text-muted-foreground">{enc.kind}:</span> {enc.label}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
