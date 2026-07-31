import { useState } from 'react'

import { cn } from '@/lib/utils'
import type { SpeakerSlot } from '@rules/state'

interface SpeakerStageProps {
  speakers: SpeakerSlot[]
  /** Whoever holds the text box right now; null dims the whole stage (narrator voice). */
  speakingNpcId: string | null
}

/**
 * Visual-novel staging: the cast stands on the bottom edge, the one talking steps forward and the
 * rest fall back into the scene. The portraits are the transparent half-body cutouts the character
 * pipeline produces, so `object-bottom` is what puts their feet on the floor rather than floating
 * them in the middle of the frame.
 *
 * SpeakerSlot.imageUrl is signed for an hour when the scene is staged, so a conversation that
 * outlives it renders a broken image unless someone resyncs. The silhouette is the fallback for
 * that as much as for an NPC who never got a portrait.
 */
function Figure({ speaker, isSpeaking }: { speaker: SpeakerSlot; isSpeaking: boolean }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const imageUrl = speaker.imageUrl && speaker.imageUrl !== brokenUrl ? speaker.imageUrl : null

  return (
    <figure
      className={cn(
        'flex max-h-full flex-col items-center transition-all duration-500 ease-out',
        isSpeaking ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-60 brightness-[0.6] saturate-[0.7]',
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={speaker.name}
          onError={() => setBrokenUrl(imageUrl)}
          className={cn(
            'h-[38vh] w-auto max-w-[38vw] object-contain object-bottom transition-transform duration-500 sm:h-[50vh]',
            isSpeaking && 'scale-[1.04] drop-shadow-[0_20px_35px_rgba(0,0,0,0.6)]',
          )}
        />
      ) : (
        <div
          aria-hidden
          className="flex h-40 w-28 items-end justify-center rounded-t-[3.5rem] bg-gradient-to-b from-slate-600/70 to-slate-950/80 text-5xl ring-1 ring-white/10 sm:h-56 sm:w-40"
        >
          <span className="pb-6 font-semibold text-white/70">{speaker.name.charAt(0)}</span>
        </div>
      )}
      <figcaption className="sr-only">{speaker.name}</figcaption>
    </figure>
  )
}

export function SpeakerStage({ speakers, speakingNpcId }: SpeakerStageProps) {
  if (speakers.length === 0) return null

  const side = (which: 'left' | 'right') =>
    speakers
      .filter((speaker) => speaker.side === which)
      .map((speaker) => (
        <Figure key={speaker.npcId} speaker={speaker} isSpeaking={speakingNpcId === speaker.npcId} />
      ))

  return (
    <div className="pointer-events-none relative flex min-h-0 flex-1 items-end justify-between gap-2 px-2 sm:px-8">
      <div className="flex items-end gap-1 sm:gap-3">{side('left')}</div>
      <div className="flex items-end gap-1 sm:gap-3">{side('right')}</div>
    </div>
  )
}
