import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { BattleMapRecord } from '../types'

interface MapListProps {
  maps: BattleMapRecord[]
  status: 'loading' | 'ready' | 'error'
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onUpload: (name: string, file: File) => void
}

function matchesFilter(map: BattleMapRecord, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return map.name.toLowerCase().includes(needle) || map.tags.some((t) => t.toLowerCase().includes(needle))
}

function MapRow({ map, selected, onSelect }: { map: BattleMapRecord; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(map.id)}
        className={cn(
          'flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted',
          selected && 'bg-muted',
        )}
      >
        <img src={map.url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{map.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {map.gridCols} x {map.gridRows} tiles{map.tags.length > 0 ? ` · ${map.tags.join(', ')}` : ''}
          </span>
        </span>
        {!map.isOwner && map.isPublic && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            starter
          </span>
        )}
      </button>
    </li>
  )
}

export function MapList({ maps, status, selectedId, busy, onSelect, onUpload }: MapListProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')

  const { mine, starters } = useMemo(() => {
    const visible = maps.filter((m) => matchesFilter(m, filter))
    return {
      mine: visible.filter((m) => m.isOwner),
      starters: visible.filter((m) => !m.isOwner && m.isPublic),
    }
  }, [maps, filter])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.replace(/\.[^.]+$/, '') || 'Untitled map'
    onUpload(name, file)
    e.target.value = ''
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-hidden onChange={handleFile} />
      <Button size="sm" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
        + New map (upload image)
      </Button>
      <input
        aria-label="Filter maps"
        placeholder="Filter by name or tag..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
      />
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        {status === 'loading' && <p className="p-3 text-sm text-muted-foreground">Loading maps...</p>}
        {status === 'ready' && mine.length === 0 && starters.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {filter ? 'No maps match that filter.' : 'No maps yet. Upload one to start.'}
          </p>
        )}
        {mine.length > 0 && (
          <>
            <p className="border-b border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">My maps</p>
            <ul>
              {mine.map((m) => <MapRow key={m.id} map={m} selected={m.id === selectedId} onSelect={onSelect} />)}
            </ul>
          </>
        )}
        {starters.length > 0 && (
          <>
            <p className="border-b border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">Starter maps</p>
            <ul>
              {starters.map((m) => <MapRow key={m.id} map={m} selected={m.id === selectedId} onSelect={onSelect} />)}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
