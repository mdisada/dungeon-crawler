import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { deleteGuideRow, insertGuideRow, saveGuideRow } from '../api/save-guide-row'
import type { CoopSet, GuideData, Ingredient } from '../types'

const TYPES = ['clue', 'secret', 'event', 'item', 'rumor'] as const

function IngredientCard({ ingredient, onChanged }: { ingredient: Ingredient; onChanged: () => void }) {
  const [text, setText] = useState(String(ingredient.content.text ?? ''))
  const affinity = ingredient.revealsTo ? Object.entries(ingredient.revealsTo)[0] : null

  return (
    <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{ingredient.type}</span>
        {ingredient.pillarTags.map((tag) => (
          <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {tag}
          </span>
        ))}
        {affinity && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-400">
            {affinity[0]}: {affinity[1]}
          </span>
        )}
        <button
          type="button"
          className="ml-auto text-destructive hover:underline"
          onClick={() => void deleteGuideRow('ingredients', ingredient.id).then(onChanged)}
        >
          Delete
        </button>
      </div>
      <Textarea
        aria-label="Ingredient text"
        className="min-h-14 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== String(ingredient.content.text ?? '')) {
            void saveGuideRow('ingredients', ingredient.id, { content: { ...ingredient.content, text } }).then(onChanged)
          }
        }}
      />
      {ingredient.reveals && <p className="text-xs text-muted-foreground">Reveals: {ingredient.reveals}</p>}
    </li>
  )
}

function CoopSetGroup({ set, members, onChanged }: { set: CoopSet; members: Ingredient[]; onChanged: () => void }) {
  async function dissolve() {
    for (const member of members) {
      await saveGuideRow('ingredients', member.id, { coop_set_id: null })
    }
    await deleteGuideRow('coop_sets', set.id)
    onChanged()
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-sky-500/40 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">
          {set.kind === 'split_knowledge' ? 'Split knowledge' : 'Complementary obstacle'}
        </span>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => void dissolve()}>
          Dissolve set
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Pooled: {set.reveals}</p>
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <IngredientCard key={m.id} ingredient={m} onChanged={onChanged} />
        ))}
      </ul>
    </li>
  )
}

// F04 SS5.4: collapsible drawer on all tabs - the toy box, filterable by chapter and type,
// with coop sets rendered as grouped cards (SS4.1).
export function IngredientsDrawer({ data, onChanged }: { data: GuideData; onChanged: () => void }) {
  const [chapterFilter, setChapterFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const visible = data.ingredients.filter(
    (i) =>
      (chapterFilter === 'all' || i.chapterId === chapterFilter) &&
      (typeFilter === 'all' || i.type === typeFilter),
  )
  const grouped = data.coopSets
    .map((set) => ({ set, members: visible.filter((i) => i.coopSetId === set.id) }))
    .filter((g) => g.members.length > 0)
  const loose = visible.filter((i) => !i.coopSetId)

  async function addIngredient() {
    await insertGuideRow('ingredients', {
      adventure_id: data.adventure.id,
      chapter_id: chapterFilter === 'all' ? null : chapterFilter,
      type: 'clue',
      content: { text: '' },
      canon_source: 'dm',
      human_edited: true,
    })
    onChanged()
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Filter by chapter"
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={chapterFilter}
          onChange={(e) => setChapterFilter(e.target.value)}
        >
          <option value="all">All chapters</option>
          {data.chapters.map((c) => (
            <option key={c.id} value={c.id}>
              Chapter {c.index + 1}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by type"
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => void addIngredient()}>
          Add
        </Button>
      </div>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {grouped.map(({ set, members }) => (
          <CoopSetGroup key={set.id} set={set} members={members} onChanged={onChanged} />
        ))}
        {loose.map((i) => (
          <IngredientCard key={i.id} ingredient={i} onChanged={onChanged} />
        ))}
        {visible.length === 0 && <p className="text-xs text-muted-foreground">No ingredients match the filters.</p>}
      </ul>
    </div>
  )
}
