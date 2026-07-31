import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { LocationMedia, MediaKind } from '../api/location-media'
import { useLocationMedia } from '../hooks/use-location-media'
import { LOCATION_TAGS } from '../media-tags'
import { useMediaUrl } from '../hooks/use-media-url'

interface Props {
  kind: MediaKind
  /** Tags to open on, usually the ones already inferred for this location. */
  suggestedTags?: string[]
  onPick: (media: LocationMedia) => void
  onClose: () => void
}

function MediaCard({ media, onPick }: { media: LocationMedia; onPick: () => void }) {
  const url = useMediaUrl(media.path)
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onPick}
        className="group relative overflow-hidden rounded-md border hover:border-primary focus-visible:border-primary"
        title={media.tags.join(', ')}
      >
        {url ? (
          <img src={url} alt={media.name} className="aspect-video w-full object-cover" />
        ) : (
          <span className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
            loading…
          </span>
        )}
      </button>
      <span className="truncate text-xs text-muted-foreground" title={media.name}>
        {media.name}
        {media.gridCols ? ` · ${media.gridCols}×${media.gridRows}` : ''}
      </span>
    </li>
  )
}

/**
 * The shelf: pick a background or map that already exists instead of drawing a new one. Opens
 * filtered to the location's own tags, because the nearest thing to "a drowned harbour" is usually
 * another coast, and widens to everything on request.
 */
export function LocationMediaPicker({ kind, suggestedTags = [], onPick, onClose }: Props) {
  const [tags, setTags] = useState<string[]>(suggestedTags.slice(0, 2))
  const state = useLocationMedia(kind, tags)

  const toggle = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]))

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Reuse {kind === 'map' ? 'a map' : 'a background'}</h4>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {LOCATION_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              tags.includes(tag) ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
      {state.status === 'loading' && <p className="text-xs text-muted-foreground">Loading…</p>}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing on the shelf{tags.length > 0 ? ' with those tags' : ''} yet — generated art is filed here
          automatically.
        </p>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {state.items.map((media) => (
            <MediaCard key={media.id} media={media} onPick={() => onPick(media)} />
          ))}
        </ul>
      )}
    </section>
  )
}
