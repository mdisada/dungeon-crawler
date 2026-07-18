import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { setNpcState } from '../../api/story'
import type { GuideNpc } from '../../api/story'

interface NpcStateControlProps {
  adventureId: string
  npcs: GuideNpc[]
  busy: boolean
  onError: (message: string) => void
}

/** World-fact override (F07 SS5.2): mark an NPC dead/alive/absent for the consistency pass. */
export function NpcStateControl({ adventureId, npcs, busy, onError }: NpcStateControlProps) {
  const [npcId, setNpcId] = useState('')
  const [value, setValue] = useState<'dead' | 'alive' | 'absent'>('dead')

  return (
    <div className="flex gap-2">
      <label htmlFor="fact-npc" className="sr-only">
        NPC
      </label>
      <select
        id="fact-npc"
        value={npcId}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNpcId(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        <option value="">Pick an NPC…</option>
        {npcs.map((npc) => (
          <option key={npc.id} value={npc.id}>
            {npc.name}
          </option>
        ))}
      </select>
      <label htmlFor="fact-state" className="sr-only">
        State
      </label>
      <select
        id="fact-state"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setValue(e.target.value as typeof value)}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        <option value="dead">dead</option>
        <option value="alive">alive</option>
        <option value="absent">absent</option>
      </select>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !npcId}
        onClick={() => void setNpcState(adventureId, npcId, value).catch((err: Error) => onError(err.message))}
      >
        Set
      </Button>
    </div>
  )
}
