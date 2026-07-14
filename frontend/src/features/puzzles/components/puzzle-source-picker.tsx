import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ARCHETYPES } from '../constants'
import { PUZZLE_TEMPLATES } from '../templates'
import { ArchetypePicker } from './archetype-picker'

type Tab = 'templates' | 'describe'

type Props = {
  busy: boolean
  onPickTemplate: (templateId: string) => void
  onCompile: (description: string, archetype: string) => void
}

export function PuzzleSourcePicker({ busy, onPickTemplate, onCompile }: Props) {
  const [tab, setTab] = useState<Tab>('templates')
  const [archetype, setArchetype] = useState('riddle')
  const [description, setDescription] = useState('')

  const seed = ARCHETYPES.find((a) => a.id === archetype)?.seed ?? ''

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'templates' ? 'default' : 'outline'}
          onClick={() => setTab('templates')}
        >
          Templates
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'describe' ? 'default' : 'outline'}
          onClick={() => setTab('describe')}
        >
          Describe your own
        </Button>
      </div>

      {tab === 'templates' ? (
        <div className="flex flex-col gap-2">
          {PUZZLE_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={busy}
              onClick={() => onPickTemplate(template.id)}
              className="flex flex-col items-start gap-0.5 rounded-md border border-border p-3 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="font-medium">{template.definition.title}</span>
              <span className="text-xs text-muted-foreground">
                {template.definition.presentation === 'map' ? 'Map puzzle' : 'Text puzzle'} ·{' '}
                {template.archetype}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ArchetypePicker value={archetype} onChange={setArchetype} disabled={busy} />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={seed || 'Describe the puzzle you have in mind…'}
            disabled={busy}
            rows={3}
          />
          <Button
            type="button"
            onClick={() => onCompile(description.trim() || seed, archetype)}
            disabled={busy || (!description.trim() && !seed)}
          >
            {busy ? 'Compiling…' : 'Compile'}
          </Button>
        </div>
      )}
    </div>
  )
}
