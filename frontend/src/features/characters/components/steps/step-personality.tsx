import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { timeJob } from '@/lib/job-timer'
import { uploadCharacterVoiceClip } from '../../api/upload-character-image'
import {
  APPEARANCE_SUGGESTIONS,
  HISTORY_SUGGESTIONS,
  QUIRK_SUGGESTIONS,
  RACE_APPEARANCE_SUGGESTIONS,
} from '../../content/personality-suggestions'
import { randomPhysical } from '../../lib/physical-defaults'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'

const ALIGNMENTS = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'True Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
]

function SuggestionChips({
  title,
  suggestions,
  freeformText,
  onAdd,
}: {
  title: string
  suggestions: string[]
  freeformText: string
  onAdd: (text: string) => void
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => {
          const isAdded = freeformText.includes(suggestion)
          return (
            <button
              key={suggestion}
              type="button"
              disabled={isAdded}
              onClick={() => onAdd(suggestion)}
              className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted disabled:border-primary/40 disabled:bg-primary/10 disabled:opacity-70"
            >
              {suggestion}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function StepPersonality({
  draft,
  updateDraft,
  goNext,
  goBack,
  characterId,
}: WizardStepProps & { characterId: string | null }) {
  const [isUploadingVoice, setIsUploadingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const appearanceSuggestions = [
    ...APPEARANCE_SUGGESTIONS,
    ...((draft.raceKey && RACE_APPEARANCE_SUGGESTIONS[draft.raceKey]) || []),
  ]

  // Physical defaults are rolled from the character's race (age/height ranges and hair/eye
  // palettes differ per species) the first time this step renders with empty fields.
  const hasAnyPhysical = Boolean(
    draft.physical.age || draft.physical.height || draft.physical.hair || draft.physical.eyes,
  )
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current || hasAnyPhysical) return
    initializedRef.current = true
    updateDraft({ physical: { ...draft.physical, ...randomPhysical(draft.raceKey) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot init, not a sync effect
  }, [])

  const rollPhysical = () => {
    updateDraft({ physical: { ...draft.physical, ...randomPhysical(draft.raceKey) } })
  }

  const addSuggestion = (text: string) => {
    const current = draft.freeformText.trim()
    updateDraft({ freeformText: current ? `${current}\n${text}` : text })
  }

  async function handleVoiceFile(file: File | undefined) {
    if (!file || !characterId) return
    setIsUploadingVoice(true)
    setVoiceError(null)
    try {
      const { result: clipPath } = await timeJob('upload-voice-clip', () =>
        uploadCharacterVoiceClip(characterId, file),
      )
      updateDraft({ voice: { source: 'clip', clipPath } })
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to upload voice clip')
    } finally {
      setIsUploadingVoice(false)
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Personality &amp; Description</h2>

      <div className="mb-4">
        <Label htmlFor="character-name">Name</Label>
        <Input
          id="character-name"
          value={draft.name}
          onChange={(e) => updateDraft({ name: e.target.value })}
          className="mt-1 max-w-sm"
        />
      </div>

      <div className="mb-4">
        <Label htmlFor="alignment">Alignment</Label>
        <Select value={draft.alignment || undefined} onValueChange={(v) => updateDraft({ alignment: v ?? '' })}>
          <SelectTrigger id="alignment" className="mt-1 w-full max-w-sm">
            <SelectValue placeholder="None chosen">{(value: string | null) => value ?? 'None chosen'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ALIGNMENTS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4">
        <Label htmlFor="freeform">
          Anything that makes this character unique — quirks, history, appearance, voice
        </Label>
        <div className="mt-2">
          <SuggestionChips
            title="Quirks — click to add"
            suggestions={QUIRK_SUGGESTIONS}
            freeformText={draft.freeformText}
            onAdd={addSuggestion}
          />
          <SuggestionChips
            title="History"
            suggestions={HISTORY_SUGGESTIONS}
            freeformText={draft.freeformText}
            onAdd={addSuggestion}
          />
          <SuggestionChips
            title="Appearance"
            suggestions={appearanceSuggestions}
            freeformText={draft.freeformText}
            onAdd={addSuggestion}
          />
        </div>
        <Textarea
          id="freeform"
          value={draft.freeformText}
          onChange={(e) => updateDraft({ freeformText: e.target.value })}
          className="mt-1"
          rows={5}
          placeholder="...or write your own"
        />
      </div>

      <div className="mb-4">
        <div className="mb-1 flex items-center gap-3">
          <p className="text-sm font-medium">Physical traits</p>
          <button
            type="button"
            onClick={rollPhysical}
            className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
          >
            Randomize for race
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(['age', 'height', 'hair', 'eyes'] as const).map((field) => (
            <div key={field}>
              <Label htmlFor={`physical-${field}`} className="capitalize">
                {field}
              </Label>
              <Input
                id={`physical-${field}`}
                value={draft.physical[field]}
                onChange={(e) => updateDraft({ physical: { ...draft.physical, [field]: e.target.value } })}
                className="mt-1"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-md border p-4">
        <p className="mb-1 text-sm font-medium">Voice</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Used for this character's spoken lines in play. Voice cloning from your clip arrives with the
          audio pipeline (Phase 3) — the clip is stored with the character now.
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="voice-source"
              checked={draft.voice.source === 'default'}
              onChange={() => updateDraft({ voice: { source: 'default' } })}
            />
            Default narrator voice
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="voice-source"
              checked={draft.voice.source === 'clip'}
              onChange={() => fileInputRef.current?.click()}
            />
            Custom — from an audio clip (3-30s)
            {draft.voice.source === 'clip' && draft.voice.clipPath && (
              <span className="text-xs text-muted-foreground">(clip uploaded ✓)</span>
            )}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            aria-label="Upload a voice clip"
            onChange={(e) => void handleVoiceFile(e.target.files?.[0])}
          />
          {draft.voice.source === 'clip' && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingVoice}
              className="w-fit rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              {isUploadingVoice ? 'Uploading…' : 'Replace clip'}
            </button>
          )}
          {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}
        </div>
      </div>

      <StepNav onBack={goBack} onNext={goNext} />
    </div>
  )
}
