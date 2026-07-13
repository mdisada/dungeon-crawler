import { Lock, Unlock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { useCampaignManager } from '../hooks/use-campaign-manager'
import { CostBadge } from './cost-badge'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
}

export function OutlineStep({ manager }: Props) {
  const {
    setup,
    outline,
    outlineCost,
    chapterCount,
    sessionsPerChapter,
    locks,
    isRegenerating,
    isSaving,
    updateChapter,
    updateSession,
    toggleChapterLock,
    toggleSessionLock,
    regenerateUnlockedChapters,
    saveGeneratedCampaign,
    backToSetup,
  } = manager

  if (!outline || !locks) return null

  const isOneShot = setup.campaignType === 'one-shot'
  const allLocked = locks.chapters.length > 0 && locks.chapters.every((c) => c.locked)
  const busy = isRegenerating || isSaving

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{isOneShot ? 'Story outline' : 'Campaign outline'}</h2>
          {chapterCount !== null && sessionsPerChapter !== null && (
            <p className="text-sm text-muted-foreground">
              {isOneShot
                ? 'One-shot — a single session'
                : `${chapterCount} chapter${chapterCount === 1 ? '' : 's'} × ${sessionsPerChapter} session${sessionsPerChapter === 1 ? '' : 's'} each. Lock what you like, then regenerate the rest.`}
            </p>
          )}
        </div>
        {outlineCost !== null && <CostBadge cost={outlineCost} />}
      </div>

      <div className="flex flex-col gap-6 text-left">
        {outline.chapters.map((chapter, chapterIndex) => {
          const chapterLocked = locks.chapters[chapterIndex]?.locked ?? false

          return (
            <div key={chapterIndex} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <LockButton
                  locked={chapterLocked}
                  label={isOneShot ? 'Lock this story' : `Lock chapter ${chapterIndex + 1}`}
                  onClick={() => toggleChapterLock(chapterIndex)}
                  disabled={busy}
                />
                <div className="flex flex-1 flex-col gap-3">
                  {!isOneShot && (
                    <span className="text-sm font-medium text-muted-foreground">
                      Chapter {chapterIndex + 1}
                    </span>
                  )}
                  <Input
                    value={chapter.title}
                    onChange={(e) => updateChapter(chapterIndex, { title: e.target.value })}
                    disabled={busy}
                    placeholder="Title"
                  />

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Big goal</span>
                    <Textarea
                      value={chapter.bigGoal}
                      onChange={(e) => updateChapter(chapterIndex, { bigGoal: e.target.value })}
                      disabled={busy}
                      rows={2}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Twists &amp; turns</span>
                    {chapter.twists.map((twist, twistIndex) => (
                      <div key={twistIndex} className="flex items-center gap-2">
                        <Input
                          value={twist}
                          onChange={(e) => {
                            const twists = chapter.twists.map((t, i) => (i === twistIndex ? e.target.value : t))
                            updateChapter(chapterIndex, { twists })
                          }}
                          disabled={busy}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          onClick={() => {
                            const twists = chapter.twists.filter((_, i) => i !== twistIndex)
                            updateChapter(chapterIndex, { twists })
                          }}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="self-start"
                      onClick={() => updateChapter(chapterIndex, { twists: [...chapter.twists, ''] })}
                    >
                      Add twist
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {chapter.sessions.map((session, sessionIndex) => {
                  const sessionLocked = locks.chapters[chapterIndex]?.sessions[sessionIndex] ?? false

                  return (
                    <div
                      key={sessionIndex}
                      className="rounded-md border border-border/60 bg-background p-3"
                    >
                      <div className="flex items-start gap-2">
                        {!isOneShot && (
                          <LockButton
                            locked={chapterLocked || sessionLocked}
                            label={`Lock session ${sessionIndex + 1}`}
                            onClick={() => toggleSessionLock(chapterIndex, sessionIndex)}
                            disabled={busy || chapterLocked}
                          />
                        )}
                        <div className="flex flex-1 flex-col gap-3">
                          {!isOneShot && (
                            <span className="text-sm font-medium">Session {sessionIndex + 1}</span>
                          )}
                          <SessionField
                            label="Hook"
                            value={session.hook}
                            disabled={busy}
                            onChange={(hook) => updateSession(chapterIndex, sessionIndex, { hook })}
                          />
                          <SessionField
                            label="Dilemma / conflict / climax"
                            value={session.conflictClimax}
                            disabled={busy}
                            onChange={(conflictClimax) =>
                              updateSession(chapterIndex, sessionIndex, { conflictClimax })
                            }
                          />
                          <SessionField
                            label="Cliffhanger / stopping point"
                            value={session.cliffhanger}
                            disabled={busy}
                            onChange={(cliffhanger) =>
                              updateSession(chapterIndex, sessionIndex, { cliffhanger })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || allLocked}
          onClick={regenerateUnlockedChapters}
        >
          {isRegenerating
            ? 'Regenerating…'
            : allLocked
              ? 'Everything is locked'
              : 'Regenerate unlocked'}
        </Button>
        <Button onClick={saveGeneratedCampaign} disabled={busy}>
          {isSaving ? 'Saving…' : 'Save campaign'}
        </Button>
        <Button variant="outline" onClick={backToSetup} disabled={busy}>
          Back to setup
        </Button>
      </div>
    </div>
  )
}

function LockButton({
  locked,
  label,
  onClick,
  disabled,
}: {
  locked: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      aria-pressed={locked}
      disabled={disabled}
      onClick={onClick}
      className={locked ? 'text-primary' : 'text-muted-foreground'}
    >
      {locked ? <Lock /> : <Unlock />}
    </Button>
  )
}

function SessionField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={2} />
    </div>
  )
}
