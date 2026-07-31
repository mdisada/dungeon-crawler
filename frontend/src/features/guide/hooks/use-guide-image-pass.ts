import { useCallback, useEffect, useRef, useState } from 'react'

import { generateLocationBackground, needsBackground } from '../api/location-images'
import { generateNpcImages, needsImages } from '../api/npc-images'
import type { LocationRow, Npc } from '../types'

/**
 * Fills in the guide's art after the text pipeline finishes (F04 SS5.2/SS5.3, revised 2026-07-31 -
 * images used to be an explicit click per row, which meant a cast of fourteen and a world of six
 * places arrived in play as name plates and an empty scene box).
 *
 * Deliberately sequential and deliberately behind the guide: a DM can read, edit and even start the
 * adventure while this runs, and a failed image is one missing picture rather than a blocked guide.
 * One at a time because each is a paid generation - a burst of twenty parallel requests would spend
 * the whole guide's budget before the first failure could stop it.
 *
 * NPCs come first: a portrait is what stops a speaker slot being a name plate, whereas a missing
 * background just leaves the scene box as it already was.
 */

export type PassKind = 'npc' | 'location'

export interface GuideImagePassState {
  status: 'idle' | 'running' | 'done' | 'stopped'
  total: number
  completed: number
  current: { kind: PassKind; name: string } | null
  failures: { kind: PassKind; name: string; message: string }[]
}

interface QueueItem {
  id: string
  kind: PassKind
  name: string
  run: () => Promise<unknown>
}

const IDLE: GuideImagePassState = { status: 'idle', total: 0, completed: 0, current: null, failures: [] }

export function useGuideImagePass(
  adventureId: string | undefined,
  { npcs, locations }: { npcs: Npc[]; locations: LocationRow[] },
  { enabled, onItemDone }: { enabled: boolean; onItemDone: () => void },
) {
  const [state, setState] = useState<GuideImagePassState>(IDLE)
  // Refs, not state: the loop must not restart when the parent re-renders with refreshed rows, and
  // `stopped` has to be readable from inside an already-running iteration.
  const isRunning = useRef(false)
  const stopped = useRef(false)
  const attempted = useRef(new Set<string>())
  const onItemDoneRef = useRef(onItemDone)
  onItemDoneRef.current = onItemDone

  const stop = useCallback(() => {
    stopped.current = true
    setState((prev) => (prev.status === 'running' ? { ...prev, status: 'stopped', current: null } : prev))
  }, [])

  const run = useCallback(
    async (queue: QueueItem[]) => {
      if (!adventureId || isRunning.current || queue.length === 0) return
      isRunning.current = true
      stopped.current = false
      setState({ status: 'running', total: queue.length, completed: 0, current: null, failures: [] })

      for (const item of queue) {
        if (stopped.current) break
        attempted.current.add(item.id)
        setState((prev) => ({ ...prev, current: { kind: item.kind, name: item.name } }))
        try {
          await item.run()
          onItemDoneRef.current()
        } catch (err) {
          setState((prev) => ({
            ...prev,
            failures: [
              ...prev.failures,
              { kind: item.kind, name: item.name, message: err instanceof Error ? err.message : 'failed' },
            ],
          }))
        }
        setState((prev) => ({ ...prev, completed: prev.completed + 1 }))
      }

      isRunning.current = false
      setState((prev) => ({ ...prev, status: stopped.current ? 'stopped' : 'done', current: null }))
    },
    [adventureId],
  )

  // The cast, for stripping names out of location prompts - a background is a place, not a scene
  // with people in it (location-prompt.ts).
  const castNames = npcs.map((npc) => npc.name)

  // `attempted` is what keeps this from looping: a row that failed, or whose generation produced
  // nothing, still counts as attempted and is not picked up again until the DM asks for it.
  //
  // Empty while disabled, so the count is always "what a click would draw right now". It used to
  // ignore `enabled` and only `start` checked it, which put a "Draw all 14" button on screen
  // through the whole text pipeline that silently did nothing when pressed.
  const pending: QueueItem[] = enabled && adventureId
    ? [
        ...npcs
          .filter((npc) => needsImages(npc) && !attempted.current.has(npc.id))
          .map((npc) => ({
            id: npc.id,
            kind: 'npc' as const,
            name: npc.name,
            run: () => generateNpcImages(adventureId, npc),
          })),
        ...locations
          .filter((location) => needsBackground(location) && !attempted.current.has(location.id))
          .map((location) => ({
            id: location.id,
            kind: 'location' as const,
            name: location.name,
            run: () => generateLocationBackground(adventureId, location, castNames),
          })),
      ]
    : []

  /**
   * Starts the batch. Deliberately NOT an effect (2026-07-31, owner's call): art used to fill in by
   * itself once the pipeline landed, which spent on every NPC and location whether or not the DM
   * wanted that one drawn - and a guide often reuses art it already has. Every generation now
   * follows a click, here or on the row itself.
   */
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const start = useCallback(() => {
    if (!enabled || pendingRef.current.length === 0 || isRunning.current) return
    void run(pendingRef.current)
  }, [enabled, run])

  // Clearing the flag on mount matters in StrictMode, where the dev double-invoke runs the cleanup
  // between two mounts: without the reset, the pass would stop after its first item and never resume.
  useEffect(() => {
    stopped.current = false
    return () => stop()
  }, [stop])

  const retryAll = useCallback(() => {
    attempted.current.clear()
    stopped.current = false
    setState(IDLE)
  }, [])

  return { state, start, stop, retryAll, pendingCount: pending.length }
}
