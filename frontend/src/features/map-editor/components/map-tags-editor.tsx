import { useState } from 'react'

import { cn } from '@/lib/utils'

import { MAP_TAG_SUGGESTIONS } from '../types'

interface MapTagsEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

const normalize = (t: string) => t.trim().toLowerCase()

/** Chip-based tag editor: add via Enter/comma, remove via the chip, plus one-tap suggestions. */
export function MapTagsEditor({ tags, onChange }: MapTagsEditorProps) {
  const [input, setInput] = useState('')

  function add(raw: string) {
    const tag = normalize(raw)
    if (!tag || tags.includes(tag)) {
      setInput('')
      return
    }
    onChange([...tags, tag])
    setInput('')
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(input)
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      remove(tags[tags.length - 1])
    }
  }

  const suggestions = MAP_TAG_SUGGESTIONS.filter((s) => !tags.includes(s))

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Tags</span>
      <div className="flex flex-wrap gap-1 rounded-lg border border-input bg-background p-1.5">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs">
            {tag}
            <button type="button" aria-label={`Remove tag ${tag}`} className="text-muted-foreground hover:text-foreground" onClick={() => remove(tag)}>
              &times;
            </button>
          </span>
        ))}
        <input
          aria-label="Add a tag"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(input)}
          placeholder={tags.length === 0 ? 'dungeon, forest...' : ''}
          className="min-w-[6rem] flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className={cn('rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted')}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
