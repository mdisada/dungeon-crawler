import { Button } from '@/components/ui/button'
import { insertGuideRow } from '../api/save-guide-row'
import type { GuideData } from '../types'
import { EndingCard } from './ending-card'

interface EndingsTabProps {
  data: GuideData
  onChanged: () => void
}

// F04 SS5.4: hidden DM-only tab - the 3-5 candidate endings the story can land, with their
// weighted trigger signals. Live scoring/steering arrives with F08's Ending Steward.
export function EndingsTab({ data, onChanged }: EndingsTabProps) {
  const endingWarnings = data.warnings.filter((w) => w.stage === 8 && !w.resolved)

  async function addEnding() {
    await insertGuideRow('endings', {
      adventure_id: data.adventure.id,
      index: data.endings.length,
      title: 'New ending',
      tone: 'open',
      human_edited: true,
    })
    onChanged()
  }

  const dials = data.adventure.storyDials

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Hidden from players. During play the system scores each ending against how the story
        actually goes and gently steers toward the leading one - committing only near the climax.
        Endings are direction, not script: the concrete finale is written live at commitment.
      </p>

      <section className="flex flex-col gap-1 rounded-md border p-3">
        <h3 className="text-xs font-semibold text-muted-foreground">Story dials (trajectory axes, tracked -5..5 during play)</h3>
        {dials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dials yet - generate the guide or add endings that reference them.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {dials.map((d) => (
              <li key={d.key}>
                <span className="font-medium">{d.name}</span>{' '}
                <code className="text-xs text-muted-foreground">{d.key}</code> - {d.description}
              </li>
            ))}
          </ul>
        )}
      </section>

      {endingWarnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {endingWarnings.map((w) => (
            <li key={w.id}>{w.message}</li>
          ))}
        </ul>
      )}
      <ol className="flex flex-col gap-4">
        {data.endings.map((ending) => (
          <EndingCard
            key={ending.id}
            ending={ending}
            objectives={data.objectives}
            npcs={data.npcs}
            dials={dials}
            onChanged={onChanged}
          />
        ))}
      </ol>
      <div>
        <Button variant="outline" size="sm" onClick={() => void addEnding()}>
          Add ending
        </Button>
      </div>
    </div>
  )
}
