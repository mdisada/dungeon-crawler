import type { CampaignOutline } from '../types'

type Props = {
  outline: CampaignOutline
  // A one-shot is stored as 1 chapter with 1 session, but it's a single story, not a
  // "campaign" — render it flattened, with no Chapter/Session headers.
  isOneShot: boolean
}

export function OutlineView({ outline, isOneShot }: Props) {
  if (isOneShot) {
    const chapter = outline.chapters[0]
    const session = chapter?.sessions[0]
    if (!chapter || !session) return null

    return (
      <div className="flex flex-col gap-6 text-left">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-base font-medium">{chapter.title}</h3>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">Big goal: </span>
            {chapter.bigGoal}
          </p>

          {chapter.twists.length > 0 && (
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">Twists &amp; turns:</span>
              <ul className="mt-1 list-disc pl-5">
                {chapter.twists.map((twist, i) => (
                  <li key={i}>{twist}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="mt-4 space-y-1 text-sm">
            <SessionField label="Hook" value={session.hook} />
            <SessionField label="Dilemma / conflict / climax" value={session.conflictClimax} />
            <SessionField label="Cliffhanger / stopping point" value={session.cliffhanger} />
          </dl>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 text-left">
      {outline.chapters.map((chapter, chapterIndex) => (
        <div key={chapterIndex} className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-base font-medium">
            Chapter {chapterIndex + 1}: {chapter.title}
          </h3>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">Big goal: </span>
            {chapter.bigGoal}
          </p>

          {chapter.twists.length > 0 && (
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">Twists &amp; turns:</span>
              <ul className="mt-1 list-disc pl-5">
                {chapter.twists.map((twist, i) => (
                  <li key={i}>{twist}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {chapter.sessions.map((session, sessionIndex) => (
              <div key={sessionIndex} className="rounded-md border border-border/60 bg-background p-3">
                <p className="text-sm font-medium">Session {sessionIndex + 1}</p>
                <dl className="mt-1 space-y-1 text-sm">
                  <SessionField label="Hook" value={session.hook} />
                  <SessionField label="Dilemma / conflict / climax" value={session.conflictClimax} />
                  <SessionField label="Cliffhanger / stopping point" value={session.cliffhanger} />
                </dl>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
