import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { regenerateRow } from '../api/pipeline'
import { deleteGuideRow, insertGuideRow, saveGuideRow } from '../api/save-guide-row'
import type { GuideData, Npc } from '../types'
import { NpcImagePanel } from './npc-image-panel'
import { NpcStatBlockPanel } from './npc-stat-block'
import { RegenBanner } from './regen-banner'
import { VoicePicker } from './voice-picker'

interface NpcsTabProps {
  data: GuideData
  onChanged: () => void
}

function NpcOverview({ adventureId, npc, onChanged }: { adventureId: string; npc: Npc; onChanged: () => void }) {
  const [fields, setFields] = useState({
    name: npc.name,
    faction: npc.faction,
    description: npc.description,
    traits: String(npc.personality.traits ?? ''),
    wants: String(npc.personality.wants ?? ''),
  })
  const [error, setError] = useState<string | null>(null)

  function save(patch: Record<string, unknown>) {
    saveGuideRow('npcs', npc.id, patch)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="NPC name"
          className="max-w-xs text-lg font-semibold"
          value={fields.name}
          onChange={(e) => setFields((p) => ({ ...p, name: e.target.value }))}
          onBlur={() => fields.name !== npc.name && save({ name: fields.name })}
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={npc.role === 'boss'}
            onChange={(e) => save({ role: e.target.checked ? 'boss' : 'npc' })}
          />
          Boss
        </label>
        <Button variant="ghost" size="sm" onClick={() => regenerateRow('npcs', npc.id).then(onChanged).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Regenerate failed'))}>
          Regenerate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => deleteGuideRow('npcs', npc.id).then(onChanged).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed'))}
        >
          Delete
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Faction
        <Input
          className="max-w-xs text-sm text-foreground"
          value={fields.faction}
          onChange={(e) => setFields((p) => ({ ...p, faction: e.target.value }))}
          onBlur={() => fields.faction !== npc.faction && save({ faction: fields.faction })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Description
        <Textarea
          className="min-h-24 text-sm text-foreground"
          value={fields.description}
          onChange={(e) => setFields((p) => ({ ...p, description: e.target.value }))}
          onBlur={() => fields.description !== npc.description && save({ description: fields.description })}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Personality traits
          <Input
            className="text-sm text-foreground"
            value={fields.traits}
            onChange={(e) => setFields((p) => ({ ...p, traits: e.target.value }))}
            onBlur={() => save({ personality: { ...npc.personality, traits: fields.traits } })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Wants
          <Input
            className="text-sm text-foreground"
            value={fields.wants}
            onChange={(e) => setFields((p) => ({ ...p, wants: e.target.value }))}
            onBlur={() => save({ personality: { ...npc.personality, wants: fields.wants } })}
          />
        </label>
      </div>

      <NpcStatBlockPanel npc={npc} onChanged={onChanged} />
      <NpcImagePanel adventureId={adventureId} npc={npc} onChanged={onChanged} />
      <VoicePicker
        label="Voice"
        selectedVoiceId={npc.voiceId}
        onSelect={async (voiceId) => {
          await saveGuideRow('npcs', npc.id, { voice_id: voiceId })
          onChanged()
        }}
      />
      {npc.pendingRegen && (
        <RegenBanner
          table="npcs"
          rowId={npc.id}
          current={{
            name: npc.name,
            role: npc.role,
            personality: npc.personality,
            faction: npc.faction,
            description: npc.description,
            image_prompt: npc.imagePrompt,
          }}
          pendingRegen={npc.pendingRegen}
          onResolved={onChanged}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function NpcsTab({ data, onChanged }: NpcsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(data.npcs[0]?.id ?? null)
  const selected = data.npcs.find((n) => n.id === selectedId) ?? data.npcs[0] ?? null

  async function addNpc() {
    const id = await insertGuideRow('npcs', {
      adventure_id: data.adventure.id,
      name: 'New NPC',
      description: '',
      human_edited: true,
    })
    setSelectedId(id)
    onChanged()
  }

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <aside className="flex w-full flex-col gap-1 sm:w-56">
        {data.npcs.map((npc) => (
          <button
            key={npc.id}
            type="button"
            className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${npc.id === selected?.id ? 'bg-muted font-medium' : ''}`}
            onClick={() => setSelectedId(npc.id)}
          >
            <span className="truncate">{npc.name}</span>
            {npc.role === 'boss' && <span className="rounded bg-destructive/15 px-1.5 text-xs text-destructive">boss</span>}
          </button>
        ))}
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void addNpc()}>
          Add NPC
        </Button>
      </aside>
      {selected ? (
        <NpcOverview key={selected.id} adventureId={data.adventure.id} npc={selected} onChanged={onChanged} />
      ) : (
        <p className="text-sm text-muted-foreground">No NPCs yet.</p>
      )}
    </div>
  )
}
