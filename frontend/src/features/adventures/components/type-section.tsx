import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from '@/components/ui/slider'
import { CHAPTER_BOUNDS, type AdventureDraft, type AdventureType } from '../types'

interface TypeSectionProps {
  draft: AdventureDraft
  updateDraft: (patch: Partial<AdventureDraft>) => void
}

const DEFAULT_CHAPTER_RANGE = { min: 4, max: 8 } as const

const CARD_CLASSES =
  'flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-5 transition-colors ' +
  'hover:border-ring has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50'

// F03 SS3.3: one-shot vs multi-chapter; multi-chapter reveals a dual-handle chapter range
// (bounds 2-12) the Story Director treats as a target range. One-shot nulls the chapter fields.
export function TypeSection({ draft, updateDraft }: TypeSectionProps) {
  function handleSelectType(type: AdventureType) {
    if (type === 'one_shot') {
      updateDraft({ type, chaptersMin: null, chaptersMax: null })
      return
    }
    updateDraft({
      type,
      chaptersMin: draft.chaptersMin ?? DEFAULT_CHAPTER_RANGE.min,
      chaptersMax: draft.chaptersMax ?? DEFAULT_CHAPTER_RANGE.max,
    })
  }

  function handleRangeChange(value: number | readonly number[]) {
    if (!Array.isArray(value) || value.length !== 2) return
    updateDraft({ chaptersMin: value[0], chaptersMax: value[1] })
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-base font-medium">Adventure type</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={CARD_CLASSES}>
          <input
            type="radio"
            name="adventure-type"
            value="one_shot"
            checked={draft.type === 'one_shot'}
            onChange={() => handleSelectType('one_shot')}
            className="sr-only"
          />
          <span className="font-medium">One-shot</span>
          <span className="text-sm text-muted-foreground">
            A single self-contained adventure, told in one session.
          </span>
        </label>

        <label className={CARD_CLASSES}>
          <input
            type="radio"
            name="adventure-type"
            value="multi_chapter"
            checked={draft.type === 'multi_chapter'}
            onChange={() => handleSelectType('multi_chapter')}
            className="sr-only"
          />
          <span className="font-medium">Multi-chapter</span>
          <span className="text-sm text-muted-foreground">
            A full campaign guided by a handful of major quests, spanning many sessions.
          </span>
        </label>
      </div>

      {draft.type === 'multi_chapter' && (
        <div className="flex max-w-md flex-col gap-1">
          <span className="text-sm font-medium">
            Chapters: {draft.chaptersMin ?? DEFAULT_CHAPTER_RANGE.min} –{' '}
            {draft.chaptersMax ?? DEFAULT_CHAPTER_RANGE.max}
          </span>
          <Slider
            value={[
              draft.chaptersMin ?? DEFAULT_CHAPTER_RANGE.min,
              draft.chaptersMax ?? DEFAULT_CHAPTER_RANGE.max,
            ]}
            onValueChange={handleRangeChange}
            min={CHAPTER_BOUNDS.min}
            max={CHAPTER_BOUNDS.max}
            step={1}
          >
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                <SliderThumb index={0} aria-label="Minimum chapters" />
                <SliderThumb index={1} aria-label="Maximum chapters" />
              </SliderTrack>
            </SliderControl>
          </Slider>
          <span className="text-sm text-muted-foreground">
            A target range - the Story Director commits the final count during generation.
          </span>
        </div>
      )}
    </fieldset>
  )
}
