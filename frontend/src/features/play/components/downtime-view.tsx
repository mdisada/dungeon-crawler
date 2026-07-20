import type { DialogueState } from '@rules/state'

interface DowntimeViewProps {
  dialogue: DialogueState
}

/** F06 SS3.4: parchment-style log; the shared IntentInputRow overlays the bottom. */
export function DowntimeView({ dialogue }: DowntimeViewProps) {
  return (
    <div className="flex h-full w-full justify-center overflow-y-auto bg-amber-50/95 px-4 pb-24 pt-8 dark:bg-stone-900">
      <div className="w-full max-w-2xl font-serif">
        <h2 className="mb-4 text-lg font-semibold text-stone-700 dark:text-amber-100/80">Downtime</h2>
        <div className="flex flex-col gap-3">
          {dialogue.lines.map((line) => (
            <p key={line.id} className="leading-relaxed text-stone-800 dark:text-amber-50/90">
              {line.speaker && <span className="font-semibold">{line.speaker}: </span>}
              {line.text}
            </p>
          ))}
          {dialogue.lines.length === 0 && (
            <p className="text-stone-500 dark:text-amber-100/50">The party rests…</p>
          )}
          {dialogue.typing && (
            <p className="flex items-center gap-1.5" role="status" aria-label="The DM is thinking">
              <span className="size-2 animate-bounce rounded-full bg-stone-500 dark:bg-amber-100/60" />
              <span className="size-2 animate-bounce rounded-full bg-stone-500 [animation-delay:150ms] dark:bg-amber-100/60" />
              <span className="size-2 animate-bounce rounded-full bg-stone-500 [animation-delay:300ms] dark:bg-amber-100/60" />
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
