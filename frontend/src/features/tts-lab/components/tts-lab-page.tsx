import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/features/auth'
import { SceneTextBox } from '@/features/play'
import { useVoiceProfiles } from '@/features/tts'
import { isTtsLabUser } from '../debug'
import { useLabRun } from '../hooks/use-lab-run'
import { SAMPLE_SCRIPT } from '../sample-script'
import { DEFAULT_LAB_SETTINGS } from '../types'
import type { LabSettings } from '../types'
import { ChunkTimeline } from './chunk-timeline'
import { LabControls } from './lab-controls'

/**
 * The narration sequencing bench (F12).
 *
 * It runs the real gating hook against the real `narration-tts` function and renders the real
 * SceneTextBox - no session, no adventure, no LLM. What you feel here is what play will feel,
 * because it is the same code; the only thing simulated is where the text came from.
 */
export function TtsLabPage() {
  const { session } = useSession()
  const email = session?.user.email ?? null
  const userId = session?.user.id ?? null
  const { profiles, error: voiceError } = useVoiceProfiles(userId)
  const [script, setScript] = useState(SAMPLE_SCRIPT)
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_LAB_SETTINGS)

  // Default to whatever voice exists rather than to nothing. In play, "no voice" falls back to the
  // adventure's narrator; the lab has no adventure, so the same default could only ever mean
  // silence - which it did, silently, and looked like a broken feature (2026-08-01).
  // Derived rather than pushed into state by an effect: profiles arrive async.
  const voiceProfileId =
    settings.voiceProfileId === undefined ? (profiles[0]?.id ?? null) : settings.voiceProfileId
  const effective: LabSettings = { ...settings, voiceProfileId }
  const run = useLabRun(userId ?? '', effective)

  if (!isTtsLabUser(email)) return <p className="p-8 text-muted-foreground">Not available.</p>
  if (!userId) return null

  const { active, visibleCount, settledBoxCount, canReveal, isRevealing, audio } = run
  const boxes = active?.chunking.boxes ?? []
  const current = visibleCount > 0 ? boxes[visibleCount - 1] : ''
  const gateOpen = settledBoxCount >= visibleCount + 1
  const isSilent = audio.state.phase === 'silent'

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header>
        <Link to="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          &larr; Home
        </Link>
        <h1 className="text-xl font-semibold">TTS Lab</h1>
        <p className="text-sm text-muted-foreground">
          Narration sequencing against the real edge function and the real text box - no session, no
          adventure, no LLM. What you hear here is what play will do, because it is the same code.
        </p>
      </header>

      <Textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={6}
        aria-label="Narration script"
        placeholder="Narration script"
      />

      <LabControls
        settings={effective}
        onChange={setSettings}
        profiles={profiles}
        isRunning={active !== null}
      />
      {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}

      {profiles.length === 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          No voice profiles exist yet, so every run here would be silent. Seed the built-in voice
          (<code>supabase/seed/seed-builtin-voices.mjs</code>) or upload a clip from an adventure&apos;s
          narrator panel.
        </p>
      )}

      {isSilent && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <strong>This run is silent.</strong> No voice resolved, so nothing was synthesized and
          nothing was spent - the text still advances, which is exactly what an adventure with no
          narrator voice does in play. Pick a voice above to hear it.
        </p>
      )}

      {audio.state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <strong>Request failed.</strong> {audio.state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!script.trim()} onClick={() => run.start(script, effective)}>
          {active ? 'Restart run' : 'Run'}
        </Button>
        <Button type="button" variant="outline" disabled={!active} onClick={run.reset}>
          Stop
        </Button>
        {audio.needsUnlock && (
          <Button type="button" variant="outline" onClick={audio.unlock}>
            Enable audio
          </Button>
        )}
        {active && (
          <span className="text-xs text-muted-foreground">
            box {Math.max(1, visibleCount)}/{boxes.length} &middot; {settledBoxCount} settled &middot;{' '}
            {active.settings.model} &middot; {active.chunking.units.length} clips
          </span>
        )}
        {audio.state.error && <span className="text-xs text-destructive">{audio.state.error}</span>}
      </div>

      {/* Dark, like the play screen, so the box is judged against the background it will live on. */}
      <div className="rounded-xl bg-black p-6">
        {active && !canReveal ? (
          <p className="py-8 text-center text-sm text-white/40" aria-live="polite">
            Holding for the first clip...
          </p>
        ) : (
          <SceneTextBox
            speaker={null}
            text={current}
            isRevealing={isRevealing && gateOpen}
            onAdvance={run.advance}
          />
        )}
        {active && isRevealing && !gateOpen && (
          <p className="pt-3 text-center text-xs text-white/40" aria-live="polite">
            Next clip not ready - chevron held
          </p>
        )}
      </div>

      {active && (
        <ChunkTimeline
          chunking={active.chunking}
          chunks={audio.state.chunks}
          revealedAt={run.revealedAt}
          settledUnits={audio.settled}
          serverTimings={audio.state.serverTimings}
        />
      )}
    </div>
  )
}
