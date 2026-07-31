import { useState } from 'react'

import { useSession } from '@/features/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { generateLocationBackground } from '../api/location-images'
import { regenerateRow } from '../api/pipeline'
import type { LocationMedia } from '../api/location-media'
import { deleteGuideRow, insertGuideRow, saveGeneratedMedia, saveGuideRow } from '../api/save-guide-row'
import { tagsFromText } from '../media-tags'
import { LocationMediaPicker } from './location-media-picker'
import { useMediaUrl } from '../hooks/use-media-url'
import type { GuideData, LocationRow } from '../types'
import { LocationMapDialog } from './location-map-dialog'
import { RegenBanner } from './regen-banner'

function LocationOverview({ adventureId, location, userId, castNames, onChanged }: { adventureId: string; location: LocationRow; userId: string; castNames: string[]; onChanged: () => void }) {
  const [fields, setFields] = useState({
    name: location.name,
    description: location.description,
    imagePrompt: location.imagePrompt,
  })
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMapOpen, setIsMapOpen] = useState(false)
  const [isPickingBackground, setIsPickingBackground] = useState(false)
  const backgroundUrl = useMediaUrl(location.backgroundPath)
  const spawnCount = location.map ? location.map.spawns.party.length + location.map.spawns.enemy.length : 0

  function save(patch: Record<string, unknown>) {
    saveGuideRow('locations', location.id, patch)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  /**
   * Points the location at a plate that already exists. The path is shared, not copied: the storage
   * policy on `location_media` is what lets another adventure read it, and duplicating the object
   * would cost storage to gain nothing.
   */
  async function applyExistingBackground(media: LocationMedia) {
    setIsBusy(true)
    setError(null)
    try {
      const previous = location.backgroundPath
        ? [location.backgroundPath, ...location.previousBackgroundPaths].slice(0, 3)
        : location.previousBackgroundPaths
      await saveGeneratedMedia('locations', location.id, {
        background_url: media.path,
        previous_background_urls: previous,
      })
      setIsPickingBackground(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that background')
    } finally {
      setIsBusy(false)
    }
  }

  // F04 SS5.3: one row's worth of the batch on the guide header, and the same function underneath,
  // so a hand-triggered plate gets the same 16:9 frame and people-free prompt as a batched one.
  async function generateBackground() {
    setIsBusy(true)
    setError(null)
    try {
      if (fields.imagePrompt !== location.imagePrompt) {
        await saveGuideRow('locations', location.id, { image_prompt: fields.imagePrompt })
      }
      const path = await generateLocationBackground(adventureId, { ...location, imagePrompt: fields.imagePrompt }, castNames)
      if (!path) setError('This location has no description to draw from yet.')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Background generation failed')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Location name"
          className="max-w-xs text-lg font-semibold"
          value={fields.name}
          onChange={(e) => setFields((p) => ({ ...p, name: e.target.value }))}
          onBlur={() => fields.name !== location.name && save({ name: fields.name })}
        />
        <Button variant="ghost" size="sm" onClick={() => regenerateRow('locations', location.id).then(onChanged).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Regenerate failed'))}>
          Regenerate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => deleteGuideRow('locations', location.id).then(onChanged).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed'))}
        >
          Delete
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Description
        <Textarea
          className="min-h-24 text-sm text-foreground"
          value={fields.description}
          onChange={(e) => setFields((p) => ({ ...p, description: e.target.value }))}
          onBlur={() => fields.description !== location.description && save({ description: fields.description })}
        />
      </label>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Background image</h3>
        {backgroundUrl && (
          <img src={backgroundUrl} alt={`${location.name} background`} className="max-h-56 w-full rounded-md object-cover" />
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Image prompt
          <Textarea
            className="min-h-16 text-sm text-foreground"
            value={fields.imagePrompt}
            onChange={(e) => setFields((p) => ({ ...p, imagePrompt: e.target.value }))}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={isBusy || fields.imagePrompt.trim().length === 0} onClick={() => void generateBackground()}>
            {location.backgroundPath ? 'Regenerate background' : 'Generate background'}
          </Button>
          <Button size="sm" variant="outline" disabled={isBusy} onClick={() => setIsPickingBackground((v) => !v)}>
            {isPickingBackground ? 'Cancel' : 'Reuse existing'}
          </Button>
        </div>
        {isPickingBackground && (
          <LocationMediaPicker
            kind="background"
            suggestedTags={tagsFromText(`${location.name} ${location.description} ${location.imagePrompt}`)}
            onClose={() => setIsPickingBackground(false)}
            onPick={(media) => void applyExistingBackground(media)}
          />
        )}
        {location.previousBackgroundPaths.length > 0 && (
          <p className="text-xs text-muted-foreground">{location.previousBackgroundPaths.length} previous version(s) kept.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Battle map</h3>
          <span className="text-xs text-muted-foreground">
            {location.map?.imagePath
              ? `${location.map.gridCols}x${location.map.gridRows} tiles · ${location.map.obstacles.length} obstacles · ${spawnCount} spawns`
              : 'No map yet'}
          </span>
        </div>
        <div>
          <Button size="sm" variant="outline" disabled={!userId} onClick={() => setIsMapOpen(true)}>
            {location.map?.imagePath ? 'Edit battle map' : 'Add battle map'}
          </Button>
        </div>
      </section>
      {userId && (
        <LocationMapDialog
          open={isMapOpen}
          onOpenChange={setIsMapOpen}
          adventureId={adventureId}
          location={location}
          userId={userId}
          onSaved={onChanged}
        />
      )}

      {location.pendingRegen && (
        <RegenBanner
          table="locations"
          rowId={location.id}
          current={{ name: location.name, description: location.description, image_prompt: location.imagePrompt }}
          pendingRegen={location.pendingRegen}
          onResolved={onChanged}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function LocationsTab({ data, onChanged }: { data: GuideData; onChanged: () => void }) {
  const { user } = useSession()
  const [selectedId, setSelectedId] = useState<string | null>(data.locations[0]?.id ?? null)
  const selected = data.locations.find((l) => l.id === selectedId) ?? data.locations[0] ?? null

  async function addLocation() {
    const id = await insertGuideRow('locations', {
      adventure_id: data.adventure.id,
      name: 'New location',
      description: '',
      human_edited: true,
    })
    setSelectedId(id)
    onChanged()
  }

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <aside className="flex w-full flex-col gap-1 sm:w-56">
        {data.locations.map((location) => (
          <button
            key={location.id}
            type="button"
            className={`rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${location.id === selected?.id ? 'bg-muted font-medium' : ''}`}
            onClick={() => setSelectedId(location.id)}
          >
            <span className="truncate">{location.name}</span>
          </button>
        ))}
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void addLocation()}>
          Add location
        </Button>
      </aside>
      {selected ? (
        <LocationOverview
          key={selected.id}
          adventureId={data.adventure.id}
          location={selected}
          userId={user?.id ?? ''}
          castNames={data.npcs.map((npc) => npc.name)}
          onChanged={onChanged}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No locations yet.</p>
      )}
    </div>
  )
}
