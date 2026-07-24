import { useMemo, useState } from 'react'

import type { Cell } from '@rules/combat'

import { readImageSizeUrl } from '../api/battle-maps'
import { applyPaint } from '../paint'
import { clampGrid, rowsFromAspect } from '../types'
import type { BattleMapRecord, EditorTool, MapImageFit, Spawns } from '../types'
import { useBattleMaps } from './use-battle-maps'

/** The editable fields of a map; everything else on the record (id, path, url) is immutable here. */
export interface MapDraft {
  name: string
  gridCols: number
  gridRows: number
  imageWidth: number | null
  imageHeight: number | null
  imageFit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
  tags: string[]
}

function draftOf(m: BattleMapRecord): MapDraft {
  return {
    name: m.name, gridCols: m.gridCols, gridRows: m.gridRows, imageWidth: m.imageWidth,
    imageHeight: m.imageHeight, imageFit: m.imageFit, obstacles: m.obstacles, spawns: m.spawns, tags: m.tags,
  }
}

export function useMapEditor(userId: string) {
  const maps = useBattleMaps(userId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<MapDraft | null>(null)
  const [rowsTouched, setRowsTouched] = useState(false)
  const [tool, setTool] = useState<EditorTool>('pan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => maps.maps.find((m) => m.id === selectedId) ?? null, [maps.maps, selectedId])
  const isDirty = useMemo(
    () => !!selected && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(selected)),
    [selected, draft],
  )

  // Loads a record straight into the draft. Taking the record (not just an id) avoids racing the
  // async maps-list update right after an upload.
  function applySelection(record: BattleMapRecord | null) {
    setError(null)
    setRowsTouched(false)
    setSelectedId(record?.id ?? null)
    setDraft(record ? draftOf(record) : null)
    // Backfill intrinsic dims for maps saved before we started recording them.
    if (record && record.imageWidth === null) {
      void readImageSizeUrl(record.url).then(({ width, height }) => {
        if (!width) return
        setDraft((d) => (d ? { ...d, imageWidth: width, imageHeight: height } : d))
      })
    }
  }

  function select(id: string | null) {
    applySelection(id ? maps.maps.find((m) => m.id === id) ?? null : null)
  }

  const patchDraft = (patch: Partial<MapDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  function setCols(n: number) {
    setDraft((d) => {
      if (!d) return d
      const gridCols = clampGrid(n)
      const gridRows = !rowsTouched && d.imageWidth && d.imageHeight
        ? rowsFromAspect(gridCols, d.imageWidth, d.imageHeight)
        : d.gridRows
      return { ...d, gridCols, gridRows }
    })
  }

  function setRows(n: number) {
    setRowsTouched(true)
    patchDraft({ gridRows: clampGrid(n) })
  }

  function paint(cell: Cell) {
    if (tool === 'pan') return
    setDraft((d) => (d ? applyPaint(d, cell, tool) : d))
  }

  async function upload(name: string, file: File) {
    setBusy(true)
    setError(null)
    try {
      const record = await maps.upload(name, file)
      applySelection(record)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!selected || !draft) return
    setBusy(true)
    setError(null)
    try {
      await maps.update(selected.id, draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await maps.remove(selected.id, selected.path)
      select(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return {
    maps: maps.maps,
    status: maps.status,
    loadError: maps.error,
    selected,
    draft,
    isDirty,
    tool,
    setTool,
    busy,
    error,
    select,
    setName: (name: string) => patchDraft({ name }),
    setTags: (tags: string[]) => patchDraft({ tags }),
    setCols,
    setRows,
    setImageFit: (imageFit: MapImageFit) => patchDraft({ imageFit }),
    paint,
    upload,
    save,
    remove,
  }
}
