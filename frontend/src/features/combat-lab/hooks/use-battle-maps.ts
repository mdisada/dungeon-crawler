import { useEffect, useState } from 'react'

import type { Cell } from '@rules/combat'

import { listBattleMaps, saveMapObstacles, uploadBattleMap } from '../api/battle-maps'
import type { BattleMapRecord } from '../types'

export function useBattleMaps(userId: string) {
  const [maps, setMaps] = useState<BattleMapRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listBattleMaps()
      .then((rows) => {
        if (cancelled) return
        setMaps(rows)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Maps failed to load')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function upload(name: string, file: File): Promise<BattleMapRecord> {
    const record = await uploadBattleMap(userId, name, file)
    setMaps((prev) => [record, ...prev])
    return record
  }

  async function saveObstacles(id: string, obstacles: Cell[]): Promise<void> {
    await saveMapObstacles(id, obstacles)
    setMaps((prev) => prev.map((m) => (m.id === id ? { ...m, obstacles } : m)))
  }

  return { maps, status, error, upload, saveObstacles }
}
