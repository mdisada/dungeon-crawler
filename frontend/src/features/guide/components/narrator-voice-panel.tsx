import { VOICE_SAMPLE_LINES } from '@/features/tts'
import { setNarratorVoice } from '../api/voices'
import type { GuideAdventure } from '../types'
import { VoicePicker } from './voice-picker'

interface NarratorVoicePanelProps {
  adventure: GuideAdventure
  onChanged: () => void
}

export function NarratorVoicePanel({ adventure, onChanged }: NarratorVoicePanelProps) {
  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-semibold">Narrator voice</h2>
      <VoicePicker
        label="Narrator"
        // Fixed: the narrator's job is the same in every adventure, so these stay cached forever.
        sampleLines={VOICE_SAMPLE_LINES.narrator}
        sampleKey="narrator"
        selectedVoiceId={adventure.narratorVoiceId}
        onSelect={async (voiceId) => {
          await setNarratorVoice(adventure.id, voiceId)
          onChanged()
        }}
      />
    </section>
  )
}
