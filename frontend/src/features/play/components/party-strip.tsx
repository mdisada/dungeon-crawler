import { useState } from 'react'

import { cn } from '@/lib/utils'
import type { PlayerView } from '@rules/state'

import { usePartyPortraits } from '../hooks/use-party-portraits'

interface PartyStripProps {
  players: PlayerView[]
  /** PC the current speaker is talking to (F10 SS3.7) - ringed, the way a JRPG marks the target. */
  addressedCharacterId?: string | null
}

function hpTone(ratio: number): string {
  if (ratio > 0.5) return 'bg-emerald-400'
  if (ratio > 0.25) return 'bg-amber-400'
  return 'bg-red-500'
}

function Member({
  player,
  tokenUrl,
  isAddressed,
}: {
  player: PlayerView
  tokenUrl: string | null
  isAddressed: boolean
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const url = tokenUrl && tokenUrl !== brokenUrl ? tokenUrl : null
  const ratio = player.hp.max > 0 ? Math.min(1, Math.max(0, player.hp.current / player.hp.max)) : 0

  return (
    <li className="flex w-14 flex-col items-center gap-1 sm:w-16">
      <div
        className={cn(
          'relative size-11 overflow-hidden rounded-full border-2 bg-slate-800/90 shadow-lg transition-all duration-300 sm:size-14',
          isAddressed ? 'scale-110 border-amber-300 ring-2 ring-amber-300/70' : 'border-white/25',
          player.hp.max > 0 && player.hp.current <= 0 && 'grayscale',
        )}
      >
        {url ? (
          // Decorative: the name below is what a screen reader reads, so alt stays empty.
          <img src={url} alt="" onError={() => setBrokenUrl(url)} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-sm font-medium text-white/90">
            {player.name.charAt(0)}
          </span>
        )}
      </div>

      {player.hp.max > 0 && (
        <>
          <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-black/60 ring-1 ring-white/10">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', hpTone(ratio))}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <span className="sr-only">
            {player.hp.current} of {player.hp.max} hit points
          </span>
        </>
      )}

      <span className="w-full truncate text-center text-[10px] text-white/80 drop-shadow sm:text-xs">
        {player.name}
      </span>
    </li>
  )
}

/**
 * The party bar: the table's own faces along the bottom of the scene, tokens rather than initials
 * now that every character carries one. Portraits are signed client-side from the characters
 * bucket (see api/party-portraits) - nothing here reads or writes GameState beyond the players
 * domain the renderers were already handed.
 */
export function PartyStrip({ players, addressedCharacterId = null }: PartyStripProps) {
  const portraits = usePartyPortraits(players.map((player) => player.characterId))

  if (players.length === 0) return null

  return (
    <ul className="flex flex-wrap items-end justify-center gap-2 sm:gap-3">
      {players.map((player) => (
        <Member
          key={player.characterId}
          player={player}
          tokenUrl={portraits[player.characterId]?.token ?? null}
          isAddressed={player.characterId === addressedCharacterId}
        />
      ))}
    </ul>
  )
}
