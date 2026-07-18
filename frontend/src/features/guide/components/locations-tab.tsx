import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { generateGuideImage, uploadAdventureMedia } from '../api/images'
import { regenerateRow } from '../api/pipeline'
import { deleteGuideRow, insertGuideRow, saveGuideRow } from '../api/save-guide-row'
import { useMediaUrl } from '../hooks/use-media-url'
import type { GuideData, LocationRow } from '../types'
import { MapEditor } from './map-editor'
import { RegenBanner } from './regen-banner'

const KEPT_BACKGROUNDS = 3

function LocationOverview({ adventureId, location, onChanged }: { adventureId: string; location: LocationRow; onChanged: () => void }) {
  const [fields, setFields] = useState({
    name: location.name,
    description: location.description,
    imagePrompt: location.imagePrompt,
  })
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backgroundUrl = useMediaUrl(location.backgroundPath)

  function save(patch: Record<string, unknown>) {
    saveGuideRow('locations', location.id, patch)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  // F04 SS5.3: manual-trigger background generation; regenerate keeps the last 3.
  async function generateBackground() {
    setIsBusy(true)
    setError(null)
    try {
      if (fields.imagePrompt !== location.imagePrompt) {
        await saveGuideRow('locations', location.id, { image_prompt: fields.imagePrompt })
      }
      const blob = await generateGuideImage(adventureId, fields.imagePrompt, 'background')
      const version = Date.now()
      const path = await uploadAdventureMedia(adventureId, `locations/${location.id}/background-${version}.png`, blob)
      const previous = location.backgroundPath
        ? [location.backgroundPath, ...location.previousBackgroundPaths].slice(0, KEPT_BACKGROUNDS)
        : location.previousBackgroundPaths
      await saveGuideRow('locations', location.id, { background_url: path, previous_background_urls: previous })
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
        <div>
          <Button size="sm" disabled={isBusy || fields.imagePrompt.trim().length === 0} onClick={() => void generateBackground()}>
            {location.backgroundPath ? 'Regenerate background' : 'Generate background'}
          </Button>
        </div>
        {location.previousBackgroundPaths.length > 0 && (
          <p className="text-xs text-muted-foreground">{location.previousBackgroundPaths.length} previous version(s) kept.</p>
        )}
      </section>

      <MapEditor adventureId={adventureId} location={location} onChanged={onChanged} />

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
        <LocationOverview key={selected.id} adventureId={data.adventure.id} location={selected} onChanged={onChanged} />
      ) : (
        <p className="text-sm text-muted-foreground">No locations yet.</p>
      )}
    </div>
  )
}
