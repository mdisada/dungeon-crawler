import type { SceneState } from '@rules/state'

import { usePlay } from '../hooks/use-play-context'

interface SceneBackdropProps {
  scene: SceneState
}

/**
 * The stage floor both story renderers stand on: the location plate, a vignette so the edges stop
 * competing with the figures in front of it, and the scrim the text box needs to stay legible over
 * bright art. Shared so narration and roleplay are the same place with different people in it -
 * a cut between them should not look like a cut between two games.
 */
export function SceneBackdrop({ scene }: SceneBackdropProps) {
  const { media } = usePlay()
  const backgroundUrl = media(scene.background)

  return (
    <>
      {backgroundUrl ? (
        <img
          src={backgroundUrl}
          alt={scene.locationName || 'Scene background'}
          className="ken-burns absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-indigo-950 via-slate-900 to-black"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,transparent_40%,rgba(0,0,0,0.55)_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
      />
    </>
  )
}
