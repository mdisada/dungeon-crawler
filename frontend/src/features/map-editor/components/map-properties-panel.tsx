import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import type { MapDraft } from '../hooks/use-map-editor'
import type { EditorTool, MapImageFit } from '../types'
import { MapTagsEditor } from './map-tags-editor'
import { MapToolsPanel } from './map-tools-panel'

const INPUT_CLASS = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm'

interface MapPropertiesPanelProps {
  draft: MapDraft
  tool: EditorTool
  isDirty: boolean
  isOwner: boolean
  busy: boolean
  error: string | null
  onTool: (tool: EditorTool) => void
  onName: (name: string) => void
  onTags: (tags: string[]) => void
  onCols: (n: number) => void
  onRows: (n: number) => void
  onImageFit: (fit: MapImageFit) => void
  onSave: () => void
  onDelete: () => void
}

/** Read-only summary shown for a starter map the current user does not own. */
function StarterReadOnly({ draft }: { draft: MapDraft }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div>
        <p className="text-sm font-semibold">{draft.name}</p>
        <p className="text-xs text-muted-foreground">Starter map (read only)</p>
      </div>
      <p className="text-xs text-muted-foreground">{draft.gridCols} x {draft.gridRows} tiles</p>
      {draft.tags.length > 0 && (
        <p className="text-xs text-muted-foreground">Tags: {draft.tags.join(', ')}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Obstacles {draft.obstacles.length} &middot; Party {draft.spawns.party.length} &middot; Enemy {draft.spawns.enemy.length}
      </p>
      <p className="rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
        This is a public starter map. Seed a location from it in the adventure guide to make an editable copy.
      </p>
    </div>
  )
}

export function MapPropertiesPanel({
  draft, tool, isDirty, isOwner, busy, error,
  onTool, onName, onTags, onCols, onRows, onImageFit, onSave, onDelete,
}: MapPropertiesPanelProps) {
  if (!isOwner) return <StarterReadOnly draft={draft} />

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="space-y-1">
        <Label htmlFor="map-name" className="text-xs">Name</Label>
        <input id="map-name" value={draft.name} onChange={(e) => onName(e.target.value)} className={INPUT_CLASS} />
      </div>

      <MapTagsEditor tags={draft.tags} onChange={onTags} />

      <MapToolsPanel geometry={draft} tool={tool} onTool={onTool} onCols={onCols} onRows={onRows} onImageFit={onImageFit} />

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <div className="mt-auto flex gap-2 pt-2">
        <Button size="sm" className="flex-1" disabled={!isDirty || busy} onClick={onSave}>
          {isDirty ? 'Save changes' : 'Saved'}
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  )
}
