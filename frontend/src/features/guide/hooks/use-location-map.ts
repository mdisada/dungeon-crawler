// Location-bound battle-map editor state (map-pipeline). Edits a location's map inline and persists
// it to locations.map in the adventure-media bucket (the play runtime already reads from there), so
// a location's spawns/obstacles are inherently specific to that adventure. Maps can be seeded from a
// shared starter map, which copies its image + geometry into the adventure - never a live reference.

import { useState } from 'react'

import { applyPaint, clampGrid, readImageSize, rowsFromAspect, suggestGrid } from '@/features/map-editor'
import type { BattleMapRecord, EditorTool, MapImageFit } from '@/features/map-editor'

import { generateGuideImage, uploadAdventureMedia } from '../api/images'
import { saveGuideRow } from '../api/save-guide-row'
import { DEFAULT_BATTLE_MAP } from '../types'
import type { BattleMap, LocationRow } from '../types'

const mapPath = (location: LocationRow) => `locations/${location.id}/map.png`

export function useLocationMap(adventureId: string, location: LocationRow, onSaved: () => void) {
  const [draft, setDraft] = useState<BattleMap>(location.map ?? DEFAULT_BATTLE_MAP)
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(location.map ?? DEFAULT_BATTLE_MAP))
  const [tool, setTool] = useState<EditorTool>('pan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== savedJson

  const patch = (p: Partial<BattleMap>) => setDraft((d) => ({ ...d, ...p }))

  function paint(cell: [number, number]) {
    if (tool === 'pan') return
    setDraft((d) => applyPaint(d, cell, tool))
  }

  function setCols(n: number) {
    setDraft((d) => {
      const gridCols = clampGrid(n)
      const gridRows = d.imageWidth && d.imageHeight ? rowsFromAspect(gridCols, d.imageWidth, d.imageHeight) : d.gridRows
      return { ...d, gridCols, gridRows }
    })
  }

  const setRows = (n: number) => patch({ gridRows: clampGrid(n) })
  const setImageFit = (imageFit: MapImageFit) => patch({ imageFit })

  async function persist(next: BattleMap) {
    await saveGuideRow('locations', location.id, { map: next })
    setSavedJson(JSON.stringify(next))
    onSaved()
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Map action failed')
    } finally {
      setBusy(false)
    }
  }

  const save = () => withBusy(() => persist(draft))

  const uploadImage = (file: File) =>
    withBusy(async () => {
      const path = await uploadAdventureMedia(adventureId, mapPath(location), file)
      const { width, height } = await readImageSize(file)
      const grid = width ? suggestGrid(width, height) : { cols: draft.gridCols, rows: draft.gridRows }
      const next: BattleMap = {
        ...draft, imagePath: path, imageWidth: width || null, imageHeight: height || null,
        gridCols: grid.cols, gridRows: grid.rows,
      }
      setDraft(next)
      await persist(next)
    })

  const generateImage = () =>
    withBusy(async () => {
      const blob = await generateGuideImage(adventureId, location.imagePrompt || location.description, 'map')
      const path = await uploadAdventureMedia(adventureId, mapPath(location), blob)
      // Guide map images are prompted 1:1 at 1024px.
      const next: BattleMap = { ...draft, imagePath: path, imageWidth: 1024, imageHeight: 1024 }
      setDraft(next)
      await persist(next)
    })

  // Copy a shared/starter map into this adventure: fetch its image, re-upload to the location's
  // media path, and adopt its grid/fit/obstacles/spawns. The starter row is never referenced live.
  const seedFromStarter = (starter: BattleMapRecord) =>
    withBusy(async () => {
      const res = await fetch(starter.url)
      if (!res.ok) throw new Error('Could not fetch the starter map image')
      const path = await uploadAdventureMedia(adventureId, mapPath(location), await res.blob())
      const next: BattleMap = {
        imagePath: path,
        gridCols: starter.gridCols, gridRows: starter.gridRows,
        imageWidth: starter.imageWidth, imageHeight: starter.imageHeight, imageFit: starter.imageFit,
        obstacles: starter.obstacles, spawns: starter.spawns,
      }
      setDraft(next)
      await persist(next)
    })

  return {
    draft, tool, setTool, busy, error, isDirty,
    paint, setCols, setRows, setImageFit, save, uploadImage, generateImage, seedFromStarter,
  }
}
