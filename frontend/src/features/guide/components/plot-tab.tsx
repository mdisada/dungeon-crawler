import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { regenerateRow } from '../api/pipeline'
import { insertGuideRow, saveGuideRow } from '../api/save-guide-row'
import type { GuideData } from '../types'
import { NarratorVoicePanel } from './narrator-voice-panel'
import { ObjectiveRow } from './objective-row'
import { RegenBanner } from './regen-banner'

interface PlotTabProps {
  data: GuideData
  onChanged: () => void
}

// F04 SS5.1: chapter accordion with editable arc summaries, ordered objectives, consistency
// badges, and the narrator voice panel.
export function PlotTab({ data, onChanged }: PlotTabProps) {
  const [openChapterId, setOpenChapterId] = useState<string | null>(data.chapters[0]?.id ?? null)
  const [arcDrafts, setArcDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const npcName = (id: string) => data.npcs.find((n) => n.id === id)?.name
  const locationName = (id: string) => data.locations.find((l) => l.id === id)?.name

  async function addObjective(chapterId: string) {
    setError(null)
    try {
      const chapterObjectives = data.objectives.filter((o) => o.chapterId === chapterId)
      await insertGuideRow('objectives', {
        adventure_id: data.adventure.id,
        chapter_id: chapterId,
        index: chapterObjectives.length,
        title: 'New objective',
        human_edited: true,
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add objective')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data.chapters.map((chapter) => {
        const isOpen = chapter.id === openChapterId
        const objectives = data.objectives
          .filter((o) => o.chapterId === chapter.id)
          .sort((a, b) => a.index - b.index)
        const arc = arcDrafts[chapter.id] ?? chapter.arcSummary
        return (
          <section key={chapter.id} className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpenChapterId(isOpen ? null : chapter.id)}
            >
              <span className="font-semibold">
                Chapter {chapter.index + 1}: {chapter.title}
              </span>
              <span className="text-sm text-muted-foreground">{objectives.length} objectives</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3 border-t px-4 py-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Arc summary (hidden scaffolding)
                  <Textarea
                    className="min-h-24 text-sm text-foreground"
                    value={arc}
                    onChange={(e) => setArcDrafts((prev) => ({ ...prev, [chapter.id]: e.target.value }))}
                    onBlur={() => {
                      if (arc !== chapter.arcSummary) {
                        saveGuideRow('chapters', chapter.id, { arc_summary: arc })
                          .then(onChanged)
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
                      }
                    }}
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      regenerateRow('chapters', chapter.id)
                        .then(onChanged)
                        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Regenerate failed'))
                    }}
                  >
                    Regenerate arc
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void addObjective(chapter.id)}>
                    Add objective
                  </Button>
                </div>
                {chapter.pendingRegen && (
                  <RegenBanner
                    table="chapters"
                    rowId={chapter.id}
                    current={{ title: chapter.title, arc_summary: chapter.arcSummary }}
                    pendingRegen={chapter.pendingRegen}
                    onResolved={onChanged}
                  />
                )}
                <ol className="flex flex-col gap-2">
                  {objectives.map((objective) => (
                    <ObjectiveRow
                      key={objective.id}
                      objective={objective}
                      warnings={data.warnings.filter((w) => w.targetId === objective.id && !w.resolved)}
                      npcNames={objective.linkedNpcIds.map(npcName).filter((n): n is string => Boolean(n))}
                      locationNames={objective.linkedLocationIds.map(locationName).filter((n): n is string => Boolean(n))}
                      onChanged={onChanged}
                    />
                  ))}
                </ol>
              </div>
            )}
          </section>
        )
      })}

      <NarratorVoicePanel adventure={data.adventure} onChanged={onChanged} />
    </div>
  )
}
