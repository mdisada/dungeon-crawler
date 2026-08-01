import { useCallback, useEffect, useState } from 'react'

import type { GameState, MediaRef } from '@rules/state'

import { isDirectUrl, mediaKey, signMediaRefs } from '../api/media'
import type { SignedMedia } from '../api/media'

/**
 * Re-sign well inside the 1h TTL. A play session sits open for hours, and this is the whole reason
 * signing moved to the client: the link has to be renewed by something that is still running, not
 * baked once into state by a request that ended.
 */
const REFRESH_MS = 45 * 60 * 1000

/** Every MediaRef the play screen might render, in one list. */
function sceneRefs(state: GameState): MediaRef[] {
  return [
    state.scene.background,
    ...state.dialogue.speakers.map((speaker) => speaker.image),
    state.combat?.map ?? null,
    ...(state.combat?.tokens ?? []).map((token) => token.image),
  ].filter((ref): ref is MediaRef => ref !== null && ref !== undefined)
}

export type MediaResolver = (ref: MediaRef | null | undefined) => string | null

/**
 * Resolves the scene's MediaRefs to signed URLs, and keeps them fresh.
 *
 * Re-signs when the set of paths changes (a new location, a new speaker, a fight starting) and on a
 * timer, so a table left open overnight still has its art in the morning - the failure this
 * replaced. Returns null for anything not yet signed, which every consumer already treats as "no
 * art" because an NPC without a portrait has always been possible.
 */
export function usePlayMedia(state: GameState): MediaResolver {
  const refs = sceneRefs(state)
  // The dependency is the CONTENT of the ref list, not its identity - a new state object arrives on
  // every diff and would otherwise re-sign the same paths several times a turn.
  const refKey = refs.map(mediaKey).sort().join('|')
  const [signed, setSigned] = useState<SignedMedia>({})

  useEffect(() => {
    if (!refKey) return
    let cancelled = false
    const run = () => {
      void signMediaRefs(refKey.split('|').map((key) => {
        const [bucket, path] = key.split('\n')
        return { bucket, path } as MediaRef
      })).then((next) => {
        if (!cancelled) setSigned((prev) => ({ ...prev, ...next }))
      })
    }
    run()
    const timer = setInterval(run, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refKey])

  return useCallback(
    (ref) => {
      if (!ref) return null
      // Placeholder art is already a URL. Resolving it synchronously keeps it out of the signing
      // round trip entirely - otherwise a configured placeholder would flash empty on first paint
      // waiting for a request it never needed.
      if (isDirectUrl(ref.path)) return ref.path
      return signed[mediaKey(ref)] ?? null
    },
    [signed],
  )
}
