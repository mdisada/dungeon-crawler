import { useCallback, useRef, useState } from 'react'

import { VOICE_SAMPLE_LINES } from '@/features/tts'
import { saveGeneratedMedia } from '../api/save-guide-row'
import { writeVoiceSampleLines } from '../api/voice-sample-lines'
import type { Npc } from '../types'

/**
 * The three lines this NPC auditions a voice with, written once and cached on the row.
 *
 * Lazy rather than generated with the guide: it costs nothing for NPCs nobody casts, and it works
 * for the cast you already have instead of only for new ones.
 *
 * Deliberately does NOT call the caller's onChanged. Persisting the lines is bookkeeping - nothing
 * on screen shows them - and refetching the whole guide mid-audition would remount the picker and
 * cut off the clip that is playing.
 */
export function useNpcVoiceLines(npc: Npc): { lines: string[] | null; ensure: () => void } {
  const [lines, setLines] = useState<string[] | null>(npc.voiceSampleLines)
  const isWritingRef = useRef(false)

  const ensure = useCallback(() => {
    if (lines !== null || isWritingRef.current) return
    isWritingRef.current = true
    void writeVoiceSampleLines(npc)
      .then(async (written) => {
        // A failure still gets you an audition, on the generic set - but the row stays null, so a
        // reload tries again rather than freezing this NPC on the fallback forever.
        setLines(written ?? [...VOICE_SAMPLE_LINES.npc])
        if (written) await saveGeneratedMedia('npcs', npc.id, { voice_sample_lines: written })
      })
      .catch(() => setLines([...VOICE_SAMPLE_LINES.npc]))
      .finally(() => {
        isWritingRef.current = false
      })
  }, [lines, npc])

  return { lines, ensure }
}
