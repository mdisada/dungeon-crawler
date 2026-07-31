import { useCallback, useEffect, useRef, useState } from 'react'

import { generateNpcImages, needsImages } from '../api/npc-images'
import type { Npc } from '../types'

/**
 * Fills in NPC portraits after the text pipeline finishes (F04 SS5.2, revised 2026-07-31 - images
 * used to be an explicit click per NPC, which meant a cast of fourteen arrived in play as fourteen
 * name plates).
 *
 * Deliberately sequential and deliberately behind the guide: a DM can read, edit and even start the
 * adventure while this runs, and a failed image is one missing picture rather than a blocked guide.
 * One image at a time because each is a paid generation - a burst of fourteen parallel requests
 * would spend the whole cast's budget before the first failure could stop it.
 *
 * Group rows ("the bandits") are not filtered here: stage 6 already deletes them, since a row whose
 * name is a countable enemy cannot hold one life state - see packages/rules/src/guide/group-npcs.ts.
 */

export interface NpcImagePassState {
  status: 'idle' | 'running' | 'done' | 'stopped'
  total: number
  completed: number
  currentName: string | null
  failures: { name: string; message: string }[]
}

const IDLE: NpcImagePassState = { status: 'idle', total: 0, completed: 0, currentName: null, failures: [] }

export function useNpcImagePass(
  adventureId: string | undefined,
  npcs: Npc[],
  { enabled, onNpcDone }: { enabled: boolean; onNpcDone: () => void },
) {
  const [state, setState] = useState<NpcImagePassState>(IDLE)
  // Refs, not state: the loop must not restart when the parent re-renders with refreshed rows,
  // and `stopped` has to be readable from inside an already-running iteration.
  const isRunning = useRef(false)
  const stopped = useRef(false)
  const attempted = useRef(new Set<string>())
  const onNpcDoneRef = useRef(onNpcDone)
  onNpcDoneRef.current = onNpcDone

  const stop = useCallback(() => {
    stopped.current = true
    setState((prev) => (prev.status === 'running' ? { ...prev, status: 'stopped', currentName: null } : prev))
  }, [])

  const run = useCallback(
    async (queue: Npc[]) => {
      if (!adventureId || isRunning.current || queue.length === 0) return
      isRunning.current = true
      stopped.current = false
      setState({ status: 'running', total: queue.length, completed: 0, currentName: null, failures: [] })

      for (const npc of queue) {
        if (stopped.current) break
        attempted.current.add(npc.id)
        setState((prev) => ({ ...prev, currentName: npc.name }))
        try {
          await generateNpcImages(adventureId, npc)
          onNpcDoneRef.current()
        } catch (err) {
          setState((prev) => ({
            ...prev,
            failures: [...prev.failures, { name: npc.name, message: err instanceof Error ? err.message : 'failed' }],
          }))
        }
        setState((prev) => ({ ...prev, completed: prev.completed + 1 }))
      }

      isRunning.current = false
      setState((prev) => ({
        ...prev,
        status: stopped.current ? 'stopped' : 'done',
        currentName: null,
      }))
    },
    [adventureId],
  )

  // `attempted` is what keeps this from looping: a row that failed, or whose cutout produced
  // nothing, still counts as attempted and is not picked up again until the DM asks for it.
  const pending = npcs.filter((npc) => needsImages(npc) && !attempted.current.has(npc.id))

  useEffect(() => {
    if (!enabled || pending.length === 0 || isRunning.current || stopped.current) return
    void run(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pending` is recomputed every render; the refs above own re-entry
  }, [enabled, pending.length, run])

  // Clearing the flag on mount matters in StrictMode, where the dev double-invoke runs the cleanup
  // between two mounts: without the reset, the pass would stop after its first NPC and never resume.
  useEffect(() => {
    stopped.current = false
    return () => stop()
  }, [stop])

  const retryAll = useCallback(() => {
    attempted.current.clear()
    stopped.current = false
    setState(IDLE)
  }, [])

  return { state, stop, retryAll, pendingCount: pending.length }
}
