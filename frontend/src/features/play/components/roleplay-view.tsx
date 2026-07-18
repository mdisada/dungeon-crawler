import { cn } from '@/lib/utils'
import type { DialogueState, PlayersState, SceneState } from '@rules/state'

interface RoleplayViewProps {
  scene: SceneState
  dialogue: DialogueState
  players: PlayersState
}

/**
 * F06 SS3.3 visual-novel renderer: location background, half-body NPC portraits left/right
 * (active speaker full-opacity), PC thumbnails along the bottom (the directly-addressed PC
 * highlighted, F10 SS3.7), and the name-plated text box. The Say/Do/Roll input row is the
 * play page's IntentInputRow overlay.
 */
export function RoleplayView({ scene, dialogue, players }: RoleplayViewProps) {
  const active = dialogue.lines.find((l) => l.id === dialogue.activeLineId) ?? dialogue.lines.at(-1)
  const speakingNpcId = active?.npcId ?? null

  const left = dialogue.speakers.filter((s) => s.side === 'left')
  const right = dialogue.speakers.filter((s) => s.side === 'right')

  const portrait = (speaker: (typeof dialogue.speakers)[number]) => (
    <figure
      key={speaker.npcId}
      className={cn(
        'flex max-h-full w-40 flex-col items-center transition-all duration-300 sm:w-56',
        speakingNpcId === speaker.npcId ? 'scale-105 opacity-100' : 'opacity-50',
      )}
    >
      {speaker.imageUrl ? (
        <img src={speaker.imageUrl} alt={speaker.name} className="max-h-[50vh] object-contain drop-shadow-lg" />
      ) : (
        <div
          aria-hidden
          className="flex h-48 w-32 items-end justify-center rounded-t-full bg-slate-700/80 text-5xl sm:h-64 sm:w-44"
        >
          <span className="pb-6 font-semibold text-white/70">{speaker.name.charAt(0)}</span>
        </div>
      )}
      <figcaption className="sr-only">{speaker.name}</figcaption>
    </figure>
  )

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      {scene.backgroundUrl ? (
        <img
          src={scene.backgroundUrl}
          alt={scene.locationName || 'Scene background'}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-indigo-950 via-slate-900 to-black" />
      )}

      <div className="relative flex flex-1 items-end justify-between px-4 pb-2 sm:px-10">
        <div className="flex items-end gap-2">{left.map(portrait)}</div>
        <div className="flex items-end gap-2">{right.map(portrait)}</div>
      </div>

      <div className="relative flex justify-center gap-2 pb-1">
        {players.list.map((p) => (
          <div
            key={p.characterId}
            title={p.name}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-slate-800/90 text-sm font-medium text-white/90 transition-all',
              dialogue.addressedCharacterId === p.characterId && 'scale-110 border-amber-300 ring-2 ring-amber-300/70',
            )}
          >
            {p.name.charAt(0)}
          </div>
        ))}
      </div>

      <div className="relative mx-auto mb-16 w-full max-w-4xl px-4">
        <div className="rounded-xl border border-white/10 bg-black/75 p-4 backdrop-blur">
          {active?.speaker && (
            <span className="mb-1 inline-block rounded bg-primary/80 px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {active.speaker}
            </span>
          )}
          <p className="min-h-12 text-base leading-relaxed text-white" aria-live="polite">
            {active?.text ?? '…'}
          </p>
        </div>
      </div>
    </div>
  )
}
