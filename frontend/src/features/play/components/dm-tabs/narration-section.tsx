import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { narrateNextStory, startSocialScene } from '../../api/session'
import { fetchGuideNpcs } from '../../api/story'
import type { GuideNpc } from '../../api/story'
import { usePlay } from '../../hooks/use-play-context'

/**
 * Main-tab adaptive section outside combat/roleplay: "Narrate the next story" (F07 SS5.1,
 * options auto-picked in full-AI until the Slice 3 review gate) and the social-scene
 * launcher (F10 SS2).
 */
export function NarrationSection() {
  const { adventure, state } = usePlay()
  const [npcs, setNpcs] = useState<GuideNpc[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastOptions, setLastOptions] = useState<string[]>([])

  const sessionActive = state.session.status === 'active'

  useEffect(() => {
    let cancelled = false
    fetchGuideNpcs(adventure.id)
      .then((rows) => {
        if (!cancelled) setNpcs(rows)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [adventure.id])

  async function run(label: string, call: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setNotice(null)
    try {
      await call()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id].slice(-3)))
  }

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
          {notice}
        </p>
      )}

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Narrate the next story</h3>
        <div className="flex gap-2">
          <Input
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrompt(e.target.value)}
            placeholder="Optional direction ('a storm rolls in')"
            aria-label="Narration direction"
          />
          <Button
            size="sm"
            disabled={!sessionActive || busy !== null}
            onClick={() =>
              void run('narrate', async () => {
                const out = await narrateNextStory(adventure.id, prompt.trim() || undefined)
                // Gated: the review console shows the options - don't duplicate them here.
                setLastOptions(out.resolved === 'review_staged' ? [] : out.options)
                setPrompt('')
              })
            }
          >
            {busy === 'narrate' ? 'Working…' : 'Go'}
          </Button>
        </div>
        {lastOptions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {lastOptions.map((option, i) => (
              <li key={option} className={i === 0 ? 'font-medium text-foreground' : ''}>
                {i === 0 ? '▸ ' : '· '}
                {option}
                {i === 0 && ' (auto-picked)'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Social scene</h3>
        <ul className="mb-2 flex max-h-36 flex-col gap-1 overflow-y-auto">
          {npcs.map((npc) => (
            <li key={npc.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(npc.id)} onChange={() => togglePick(npc.id)} />
                <span>
                  {npc.name}
                  {npc.generated && <span className="text-xs text-muted-foreground"> (generated)</span>}
                </span>
              </label>
            </li>
          ))}
          {npcs.length === 0 && <li className="text-xs text-muted-foreground">No NPCs in the guide yet.</li>}
        </ul>
        <Button
          size="sm"
          disabled={!sessionActive || picked.length === 0 || busy !== null}
          onClick={() =>
            void run('social', async () => {
              await startSocialScene(adventure.id, picked)
              setPicked([])
            })
          }
        >
          {busy === 'social' ? 'Staging…' : `Start scene (${picked.length || 'pick 1-3'})`}
        </Button>
      </section>
    </div>
  )
}
