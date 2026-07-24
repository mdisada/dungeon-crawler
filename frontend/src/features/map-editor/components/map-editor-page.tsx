import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'

import { useMapEditor } from '../hooks/use-map-editor'
import { MapEditorCanvas } from './map-editor-canvas'
import { MapList } from './map-list'
import { MapPropertiesPanel } from './map-properties-panel'

/** The reusable three-pane editor body (no viewport takeover) - shared by the route + the dialog. */
export function MapEditorBody({ userId, headerAction }: { userId: string; headerAction?: ReactNode }) {
  const editor = useMapEditor(userId)
  const [confirming, setConfirming] = useState(false)
  const canEdit = editor.selected?.isOwner ?? false

  async function handleDelete() {
    setConfirming(false)
    await editor.remove()
  }

  return (
    <div className="flex h-full w-full bg-background">
      <aside className="flex h-full w-[300px] shrink-0 flex-col gap-2 border-r border-border p-2">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">Maps</h1>
          {headerAction}
        </div>
        {editor.status === 'error' && (
          <p role="alert" className="text-xs text-destructive">
            {editor.loadError} (is the battle_maps migration applied?)
          </p>
        )}
        <MapList
          maps={editor.maps}
          status={editor.status}
          selectedId={editor.selected?.id ?? null}
          busy={editor.busy}
          onSelect={editor.select}
          onUpload={editor.upload}
        />
      </aside>

      <div className="relative min-w-0 flex-1">
        <MapEditorCanvas
          url={editor.selected?.url ?? null}
          cols={editor.draft?.gridCols ?? 32}
          rows={editor.draft?.gridRows ?? 32}
          imageFit={editor.draft?.imageFit ?? 'fill'}
          obstacles={editor.draft?.obstacles ?? []}
          spawns={editor.draft?.spawns ?? { party: [], enemy: [] }}
          tool={canEdit ? editor.tool : 'pan'}
          onPaint={canEdit ? editor.paint : () => {}}
        />
        {!editor.selected && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground">
              Select a map on the left, or upload a new one.
            </p>
          </div>
        )}
      </div>

      {editor.selected && editor.draft && (
        <aside className="h-full w-[300px] shrink-0 border-l border-border">
          <MapPropertiesPanel
            draft={editor.draft}
            tool={editor.tool}
            isDirty={editor.isDirty}
            isOwner={canEdit}
            busy={editor.busy}
            error={editor.error}
            onTool={editor.setTool}
            onName={editor.setName}
            onTags={editor.setTags}
            onCols={editor.setCols}
            onRows={editor.setRows}
            onImageFit={editor.setImageFit}
            onSave={editor.save}
            onDelete={() => setConfirming(true)}
          />
        </aside>
      )}

      {confirming && editor.selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-[320px] rounded-lg border border-border bg-background p-4 shadow-lg">
            <p className="text-sm font-medium">Delete "{editor.selected.name}"?</p>
            <p className="mt-1 text-xs text-muted-foreground">This removes the map and its image. It can't be undone.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The full-viewport /maps route: the editor body in a Roll20-style takeover with an Exit link. */
export function MapEditorPage() {
  const { user } = useSession()

  // Roll20 mode: the route owns the whole viewport, so the document never shows a scrollbar.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  if (!user) return <p className="text-sm text-muted-foreground">Sign in to manage maps.</p>
  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      <MapEditorBody
        userId={user.id}
        headerAction={<Link to="/" className="text-xs text-muted-foreground hover:text-foreground">Exit</Link>}
      />
    </div>
  )
}
