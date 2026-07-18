import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

import { setScene } from '../../api/session'
import { usePlay } from '../../hooks/use-play-context'

interface LocationRow {
  id: string
  name: string
  background_url: string | null
  map: { imagePath?: string | null } | null
}

/**
 * F06 SS5 Immersion tab: music picker (Storage music/{adventure_id}/), background picker, map
 * picker. Background XOR map is upstream state - picking one sends the Scene Manager intent
 * and the server flips scene.activeVisual for every client.
 */
export function DmImmersionTab() {
  const { adventure, state } = usePlay()
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [tracks, setTracks] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('locations')
      .select('id, name, background_url, map')
      .eq('adventure_id', adventure.id)
      .order('created_at')
      .then(({ data }) => !cancelled && setLocations((data ?? []) as LocationRow[]))
    void supabase.storage
      .from('music')
      .list(adventure.id)
      .then(({ data }) => !cancelled && setTracks((data ?? []).map((f) => f.name)))
    return () => {
      cancelled = true
    }
  }, [adventure.id])

  async function send(patch: Parameters<typeof setScene>[1]) {
    setBusy(true)
    setError(null)
    try {
      await setScene(adventure.id, patch)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scene change failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {error && <p className="text-destructive">{error}</p>}

      <section aria-label="Backgrounds">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Backgrounds</h3>
        <ul className="flex flex-col gap-1">
          {locations.map((loc) => (
            <li key={loc.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ location_id: loc.id, active_visual: 'background' })}
                className={cn(
                  'w-full rounded border px-2 py-1 text-left hover:bg-accent',
                  state.scene.locationId === loc.id && state.scene.activeVisual === 'background' && 'border-primary',
                )}
              >
                {loc.name || 'Unnamed location'}
                {!loc.background_url && <span className="ml-1 text-xs text-muted-foreground">(no image)</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Maps">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Maps</h3>
        <ul className="flex flex-col gap-1">
          {locations
            .filter((loc) => loc.map?.imagePath || loc.map)
            .map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ location_id: loc.id, active_visual: 'map' })}
                  className={cn(
                    'w-full rounded border px-2 py-1 text-left hover:bg-accent',
                    state.scene.locationId === loc.id && state.scene.activeVisual === 'map' && 'border-primary',
                  )}
                >
                  {loc.name || 'Unnamed location'} map
                </button>
              </li>
            ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">Picking a map hides the background and vice versa.</p>
      </section>

      <section aria-label="Music">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Music</h3>
        {tracks.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No tracks uploaded. Add files under music/{'{'}adventure-id{'}'}/ in Storage.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {tracks.map((track) => (
            <li key={track} className="flex items-center justify-between gap-2">
              <span className="truncate text-xs">{track}</span>
              {state.scene.musicTrack === track ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ music_track: null })}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ music_track: track })}>
                  Play
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
