import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { generateGuideImage, uploadAdventureMedia } from '../api/images'
import { saveGuideRow } from '../api/save-guide-row'
import { useMediaUrl } from '../hooks/use-media-url'
import type { BattleMap, LocationRow } from '../types'

const GRID = 32 // 32x32 tiles over a 1024x1024 map (MAIN-SPEC SS5 Grid/Range)

interface MapEditorProps {
  adventureId: string
  location: LocationRow
  onChanged: () => void
}

const EMPTY_MAP: BattleMap = { imagePath: null, obstacles: [], spawns: [] }

function toggle(cells: [number, number][], x: number, y: number): [number, number][] {
  const exists = cells.some(([cx, cy]) => cx === x && cy === y)
  return exists ? cells.filter(([cx, cy]) => cx !== x || cy !== y) : [...cells, [x, y]]
}

// F04 SS5.3: 1024x1024 battle map on a 32x32 grid - generate or upload the image, then place
// obstacle tiles (blocked movement) and spawn markers. Full authoring tools are out of scope.
export function MapEditor({ adventureId, location, onChanged }: MapEditorProps) {
  const [map, setMap] = useState<BattleMap>(location.map ?? EMPTY_MAP)
  const [mode, setMode] = useState<'obstacle' | 'spawn'>('obstacle')
  const [isDirty, setIsDirty] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const imageUrl = useMediaUrl(map.imagePath)

  function updateMap(next: BattleMap) {
    setMap(next)
    setIsDirty(true)
  }

  async function persist(next: BattleMap) {
    setIsBusy(true)
    setStatus(null)
    try {
      await saveGuideRow('locations', location.id, { map: next })
      setIsDirty(false)
      onChanged()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Map save failed')
    } finally {
      setIsBusy(false)
    }
  }

  async function setImage(blob: Blob) {
    setIsBusy(true)
    setStatus(null)
    try {
      const path = await uploadAdventureMedia(adventureId, `locations/${location.id}/map.png`, blob)
      const next = { ...map, imagePath: path }
      setMap(next)
      await persist(next)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Map image failed')
      setIsBusy(false)
    }
  }

  const obstacleSet = new Set(map.obstacles.map(([x, y]) => `${x},${y}`))
  const spawnSet = new Set(map.spawns.map(([x, y]) => `${x},${y}`))

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Battle map</h3>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void generateGuideImage(adventureId, location.imagePrompt || location.description, 'map').then(setImage)}>
          Generate map image
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Upload map image (1024x1024)"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void setImage(file)
            e.target.value = ''
          }}
        />
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => uploadInputRef.current?.click()}>
          Upload map (1024x1024)
        </Button>
        <Button size="sm" variant={mode === 'obstacle' ? 'default' : 'outline'} onClick={() => setMode('obstacle')}>
          Obstacles
        </Button>
        <Button size="sm" variant={mode === 'spawn' ? 'default' : 'outline'} onClick={() => setMode('spawn')}>
          Spawn markers
        </Button>
        <Button size="sm" disabled={!isDirty || isBusy} onClick={() => void persist(map)}>
          Save map
        </Button>
      </div>

      <div className="relative aspect-square w-full max-w-lg overflow-hidden rounded-md border">
        {imageUrl && <img src={imageUrl} alt={`${location.name} battle map`} className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}>
          {Array.from({ length: GRID * GRID }, (_, i) => {
            const x = i % GRID
            const y = Math.floor(i / GRID)
            const key = `${x},${y}`
            const isObstacle = obstacleSet.has(key)
            const isSpawn = spawnSet.has(key)
            return (
              <button
                key={key}
                type="button"
                aria-label={`Tile ${x + 1}, ${y + 1}${isObstacle ? ' (obstacle)' : isSpawn ? ' (spawn)' : ''}`}
                className={`border-[0.5px] border-white/10 focus-visible:ring-1 focus-visible:ring-ring ${
                  isObstacle ? 'bg-destructive/60' : isSpawn ? 'bg-emerald-500/60' : 'hover:bg-white/20'
                }`}
                onClick={() =>
                  updateMap(
                    mode === 'obstacle'
                      ? { ...map, obstacles: toggle(map.obstacles, x, y) }
                      : { ...map, spawns: toggle(map.spawns, x, y) },
                  )
                }
              />
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Click tiles to place {mode === 'obstacle' ? 'blocked-movement obstacles' : 'spawn markers'}. Red = obstacle, green = spawn.
      </p>
      {status && <p className="text-xs text-destructive">{status}</p>}
    </section>
  )
}
