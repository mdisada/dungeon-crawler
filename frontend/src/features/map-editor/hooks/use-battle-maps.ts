import { useEffect, useState } from 'react'

import { deleteBattleMap, listBattleMaps, updateBattleMap, uploadBattleMap } from '../api/battle-maps'
import type { BattleMapPatch, BattleMapRecord } from '../types'

export function useBattleMaps(userId: string) {
  const [maps, setMaps] = useState<BattleMapRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listBattleMaps(userId)
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

  async function update(id: string, patch: BattleMapPatch): Promise<void> {
    await updateBattleMap(id, patch)
    setMaps((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  async function remove(id: string, path: string): Promise<void> {
    await deleteBattleMap(id, path)
    setMaps((prev) => prev.filter((m) => m.id !== id))
  }

  return { maps, status, error, upload, update, remove }
}
