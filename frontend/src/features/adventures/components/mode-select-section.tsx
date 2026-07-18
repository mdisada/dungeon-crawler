import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DIFFICULTY_PRESETS, type AdventureDraft, type AdventureMode, type DifficultyPreset } from '../types'

interface ModeSelectSectionProps {
  draft: AdventureDraft
  updateDraft: (patch: Partial<AdventureDraft>) => void
}

const DIFFICULTY_LABELS: Record<DifficultyPreset, string> = {
  easy: 'Easy',
  standard: 'Standard',
  hard: 'Hard',
  deadly: 'Deadly',
}

const CARD_CLASSES =
  'flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-5 transition-colors ' +
  'hover:border-ring has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50'

// F03 SS3.1: two cards, radio behavior. Native radios (visually hidden) keep this keyboard- and
// screen-reader-correct without a headless primitive.
export function ModeSelectSection({ draft, updateDraft }: ModeSelectSectionProps) {
  function handleSelectMode(mode: AdventureMode) {
    updateDraft({
      mode,
      // Full-AI requires a difficulty; default Standard so the CTA isn't blocked (F03 SS6).
      difficultyPreset: mode === 'full_ai' ? (draft.difficultyPreset ?? 'standard') : draft.difficultyPreset,
    })
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-base font-medium">Mode</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={CARD_CLASSES}>
          <input
            type="radio"
            name="adventure-mode"
            value="full_ai"
            checked={draft.mode === 'full_ai'}
            onChange={() => handleSelectMode('full_ai')}
            className="sr-only"
          />
          <span className="font-medium">Full-AI DM</span>
          <span className="text-sm text-muted-foreground">
            The AI runs everything: narration, rulings, story progression. No human DM.
          </span>
          <span className="w-fit rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            v1 limits: no dungeon puzzles, difficulty fixed at creation
          </span>
        </label>

        <label className={CARD_CLASSES}>
          <input
            type="radio"
            name="adventure-mode"
            value="assist"
            checked={draft.mode === 'assist'}
            onChange={() => handleSelectMode('assist')}
            className="sr-only"
          />
          <span className="font-medium">AI-Assist</span>
          <span className="text-sm text-muted-foreground">
            You are the Dungeon Master. The AI drafts; you approve, edit, or override.
          </span>
        </label>
      </div>

      {draft.mode === 'full_ai' && (
        <div className="flex items-center gap-3">
          <span id="difficulty-label" className="text-sm font-medium">
            Difficulty
          </span>
          <Select
            aria-labelledby="difficulty-label"
            value={draft.difficultyPreset}
            onValueChange={(value) => updateDraft({ difficultyPreset: value as DifficultyPreset })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose difficulty" />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTY_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {DIFFICULTY_LABELS[preset]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">Fixed once the adventure is created.</span>
        </div>
      )}
    </fieldset>
  )
}
